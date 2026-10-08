import { readFileSync } from 'node:fs'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRateCaptures } from './helpers/modelApiRateCapture'
import { fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  ModelApiPacing,
  metaPacingLimits,
  type PacingClass,
} from '../../src/core/backends/modelapi/pacing'
import { PACING_WINDOW_MS, PACING_START_REQUESTS_PER_MINUTE } from '../../src/shared/constants'
import { fanOutPacingClass } from '../../src/core/backends/modelapi/subagentTools'

const captures = readRateCaptures()
const firstHeaders = new Headers(captures[0]?.headers)

function clockedPacer() {
  let now = 0
  const waits: number[] = []
  const pacer = new ModelApiPacing({
    now: () => now,
    wait: (ms, signal) => {
      signal.throwIfAborted()
      if (waits.length >= 20) throw new Error('Unexpected repeated pacing wait')
      waits.push(ms)
      now += ms
      return Promise.resolve()
    },
  })
  return { pacer, waits, signal: new AbortController().signal }
}

afterEach(() => {
  vi.useRealTimers()
  setUiText(EN, 'en')
})

describe('M106 request and token pacing', () => {
  it('retains concurrent debits when a stale ten-RPM response reports nine remaining', async () => {
    const { pacer, waits, signal } = clockedPacer()
    const limits = { requests: 10, remainingRequests: 10, tokens: 1000, remainingTokens: 1000 }
    pacer.observe('key', limits)
    await pacer.acquire('key', 'team', 25, signal)
    const sentA = pacer.snapshot('key')
    for (let index = 0; index < 7; index += 1) await pacer.acquire('key', 'team', 25, signal)
    const sentH = pacer.snapshot('key')
    pacer.observe(
      'key',
      { ...limits, remainingRequests: 9, remainingTokens: 975 },
      undefined,
      sentA,
    )
    expect(pacer.headroom('key')).toMatchObject({ remainingRequests: 2, remainingTokens: 800 })
    await pacer.acquire('key', 'team', 25, signal)
    // A later or out-of-order snapshot cannot refund the ninth local admission.
    pacer.observe(
      'key',
      { ...limits, remainingRequests: 8, remainingTokens: 950 },
      undefined,
      sentH,
    )
    expect(pacer.headroom('key')).toMatchObject({ remainingRequests: 1, remainingTokens: 775 })
    await pacer.acquire('key', 'team', 25, signal)
    expect(waits).toEqual([6000])
  })

  it('retains post-dispatch debits even when provider headroom is lower than local headroom', async () => {
    const { pacer, signal } = clockedPacer()
    const limits = { requests: 10, remainingRequests: 10, tokens: 1000, remainingTokens: 1000 }
    pacer.observe('key', limits)
    await pacer.acquire('key', 'team', 100, signal)
    const sent = pacer.snapshot('key')
    await pacer.acquire('key', 'team', 100, signal)
    pacer.observe('key', { ...limits, remainingRequests: 5, remainingTokens: 500 }, undefined, sent)
    expect(pacer.headroom('key')).toMatchObject({ remainingRequests: 4, remainingTokens: 400 })
  })

  it('reserves half the observed token budget for foreground after a background burst', async () => {
    const { pacer, waits, signal } = clockedPacer()
    pacer.observe('key', { requests: 10, remainingRequests: 10, tokens: 300, remainingTokens: 300 })
    await pacer.acquire('key', 'team', 75, signal)
    await pacer.acquire('key', 'team', 75, signal)
    expect(pacer.headroom('key').remainingTokens).toBe(150)
    await pacer.acquire('key', 'foreground', 150, signal)
    expect(waits).toEqual([])
    await expect(pacer.acquire('key', 'team', 151, signal)).rejects.toThrow('token budget')
  })

  it('reads the Japanese fan-out refusal at call time', async () => {
    const japanese = {
      ...EN,
      ...z
        .object({ modelApiPacingTokenLimit: z.string() })
        .parse(JSON.parse(readFileSync(new URL('../../l10n/ui.ja.json', import.meta.url), 'utf8'))),
    }
    setUiText(japanese, 'ja')
    const { pacer, signal } = clockedPacer()
    pacer.observe('key', {
      requests: 10,
      remainingRequests: 10,
      tokens: 1000,
      remainingTokens: 1000,
    })
    await expect(pacer.acquire('key', 'team', 1001, signal)).rejects.toThrow(
      japanese.modelApiPacingTokenLimit,
    )
    expect(japanese.modelApiPacingTokenLimit).not.toBe(EN.modelApiPacingTokenLimit)
  })

  it("uses a provider capability interpreter's captured window instead of imposing Meta's minute", async () => {
    const { pacer, waits, signal } = clockedPacer()
    const limits = {
      requests: 4,
      remainingRequests: 1,
      tokens: 100,
      remainingTokens: 0,
      windowMs: 120_000,
    }
    pacer.observe('captured-provider:key', limits)
    await pacer.acquire('captured-provider:key', 'team', 25, signal)
    expect(waits).toEqual([90_000])
    expect(pacer.headroom('captured-provider:key').windowMs).toBe(120_000)
    expect(pacer.headroom('meta:key').windowMs).toBe(PACING_WINDOW_MS)
    expect(() => {
      pacer.observe('captured-provider:key', { ...limits, windowMs: 0 })
    }).toThrow()
  })

  it('shares a progressing fake client clock with pacing instead of sleeping in real time', async () => {
    const client = fakeModelApiClientSettings(new FakeLogOutputChannel())
    let waits = 0
    const pacer = new ModelApiPacing({
      now: client.now,
      wait: (ms) => {
        waits += 1
        if (waits > 20) throw new Error('Fake client clock did not progress')
        return client.sleep(ms)
      },
    })
    pacer.observe('key', {
      requests: 150,
      remainingRequests: 0,
      tokens: 3_000_000,
      remainingTokens: 3_000_000,
    })
    await pacer.acquire('key', 'team', 1, new AbortController().signal)
    expect(client.now()).toBe(800)
    expect(waits).toBe(1)
  })

  it('clamps contradictory remaining counts, rejects zero limits and allows a one-RPM key', async () => {
    const headers = new Headers(firstHeaders)
    headers.set('x-ratelimit-remaining-requests', '151')
    headers.set('x-ratelimit-remaining-tokens', '3000001')
    expect(metaPacingLimits(headers)).toMatchObject({
      remainingRequests: 150,
      remainingTokens: 3_000_000,
    })
    for (const field of ['x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens']) {
      const zero = new Headers(firstHeaders)
      zero.set(field, '0')
      expect(metaPacingLimits(zero)).toBeUndefined()
    }
    const { pacer, waits, signal } = clockedPacer()
    expect(() => {
      pacer.observe('key', {
        requests: 0,
        remainingRequests: 0,
        tokens: 1000,
        remainingTokens: 1000,
      })
    }).toThrow()
    pacer.observe('key', { requests: 1, remainingRequests: 0, tokens: 1000, remainingTokens: 1000 })
    await pacer.acquire('key', 'team', 1, signal)
    expect(waits).toEqual([PACING_WINDOW_MS])
  })

  it('reads every U12 snapshot, including the streamed response, as reported at 150 RPM', () => {
    const { pacer } = clockedPacer()
    for (const capture of captures) {
      pacer.observe('meta:key', metaPacingLimits(new Headers(capture.headers)))
      expect(pacer.headroom('meta:key')).toMatchObject({
        requests: 150,
        remainingRequests: Math.min(
          ...captures
            .slice(0, captures.indexOf(capture) + 1)
            .map((entry) => Number(entry.headers['x-ratelimit-remaining-requests'])),
        ),
        tokens: 3_000_000,
        remainingTokens: Number(capture.headers['x-ratelimit-remaining-tokens']),
      })
    }
    pacer.observe('meta:key', {
      requests: 27,
      remainingRequests: 9,
      tokens: 7000,
      remainingTokens: 4000,
    })
    expect(pacer.headroom('meta:key')).toMatchObject({ requests: 27, tokens: 7000 })
  })

  it.each(['', '-1', '1.5', '1e2', 'Infinity', 'NaN', '9007199254740992'])(
    'refuses malformed limits %j without replacing the last snapshot',
    (value) => {
      const { pacer } = clockedPacer()
      pacer.observe('key', metaPacingLimits(firstHeaders))
      const headers = new Headers(firstHeaders)
      headers.set('x-ratelimit-limit-requests', value)
      expect(metaPacingLimits(headers)).toBeUndefined()
      pacer.observe('key', metaPacingLimits(headers))
      expect(pacer.headroom('key').requests).toBe(150)
      headers.delete('x-ratelimit-limit-requests')
      expect(metaPacingLimits(headers)).toBeUndefined()
    },
  )

  it('starts conservatively without guessing token limits and isolates providers and keys', async () => {
    const { pacer, waits, signal } = clockedPacer()
    for (let i = 0; i < PACING_START_REQUESTS_PER_MINUTE; i += 1) {
      await pacer.acquire('meta:key-a', 'subagent', 500, signal)
    }
    expect(waits).toEqual([PACING_WINDOW_MS / PACING_START_REQUESTS_PER_MINUTE])
    expect(pacer.headroom('meta:key-a').tokens).toBeUndefined()
    expect(pacer.headroom('meta:key-b').remainingRequests).toBe(PACING_START_REQUESTS_PER_MINUTE)
    expect(pacer.headroom('other:key-a').remainingRequests).toBe(PACING_START_REQUESTS_PER_MINUTE)
  })

  it.each<PacingClass>(['subagent', 'bestOfN', 'team', 'judge', 'schedule'])(
    'paces %s against request and token headroom',
    async (kind) => {
      const { pacer, waits, signal } = clockedPacer()
      pacer.observe('key', {
        requests: 150,
        remainingRequests: 1,
        tokens: 1000,
        remainingTokens: 0,
      })
      await pacer.acquire('key', kind, 100, signal)
      expect(waits).toEqual([36_000])
      expect(pacer.headroom('key').remainingTokens).toBe(500)
      expect(pacer.headroom('key').remainingRequests).toBe(90)
    },
  )

  it('never queues the foreground behind exhausted or paused fan-out', async () => {
    const { pacer, waits, signal } = clockedPacer()
    pacer.observe(
      'key',
      { requests: 150, remainingRequests: 0, tokens: 1000, remainingTokens: 0 },
      20_000,
    )
    await pacer.acquire('key', 'foreground', 2000, signal)
    expect(waits).toEqual([])
    expect(pacer.headroom('key').remainingRequests).toBe(0)
  })

  it('Retry-After pauses all fan-out even without valid rate headers', async () => {
    const { pacer, waits, signal } = clockedPacer()
    pacer.observe('key', metaPacingLimits(firstHeaders), 8000)
    pacer.observe('key', undefined, 2000)
    await pacer.acquire('key', 'schedule', 0, signal)
    expect(waits).toEqual([8000])
  })

  it('wakes simultaneous fan-out in admission order without overspending the bucket', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const pacer = new ModelApiPacing({
      now: Date.now,
      wait: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }),
    })
    pacer.observe('key', {
      requests: 150,
      remainingRequests: 1,
      tokens: 3_000_000,
      remainingTokens: 3_000_000,
    })
    const done: number[] = []
    const signal = new AbortController().signal
    const pending = [1, 2, 3].map(async (id) => {
      await pacer.acquire('key', 'team', 100, signal)
      done.push(id)
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(done).toEqual([1])
    await vi.advanceTimersByTimeAsync(800)
    await Promise.all(pending)
    expect(done).toEqual([1, 2, 3])
  })

  it('refuses an impossible fan-out token request and a stopped request before waiting', async () => {
    const { pacer, waits, signal } = clockedPacer()
    pacer.observe('key', {
      requests: 150,
      remainingRequests: 143,
      tokens: 1000,
      remainingTokens: 1000,
    })
    await expect(pacer.acquire('key', 'team', 1001, signal)).rejects.toThrow('token budget')
    await expect(pacer.acquire('key', 'team', -1, signal)).rejects.toThrow('estimate')
    const stop = new AbortController()
    stop.abort()
    await expect(pacer.acquire('key', 'team', 0, stop.signal)).rejects.toThrow()
    expect(waits).toEqual([])
  })

  it('recognises all existing fan-out admission tags without changing a main paid request', () => {
    expect(fanOutPacingClass('subagents')).toBe('subagent')
    expect(fanOutPacingClass('bestOfN')).toBe('bestOfN')
    expect(fanOutPacingClass('scheduledPrompts')).toBe('schedule')
    expect(fanOutPacingClass('judge')).toBe('judge')
    expect(fanOutPacingClass('webSearch')).toBe('foreground')
    expect(fanOutPacingClass(undefined)).toBe('foreground')
  })
})
