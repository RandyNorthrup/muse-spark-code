import { describe, expect, it } from 'vitest'
import { pollAllVisible, publishOnce } from '../../scripts/publish-registry.mjs'

async function neverVisible() {
  throw new Error('HTTP 404 while checking published artifact')
}

// The release publishes every artifact first and only then polls for
// visibility under one shared deadline (PLAN.md D209): a slow registry
// delays the job once instead of once per artifact, an unfinished target
// is re-checked in the same job rather than left unpublished, and a
// still-pending target warns instead of failing the job.
describe('shared visibility poll', () => {
  it('re-checks unfinished artifacts until every one is visible', async () => {
    const calls = { a: 0, b: 0, c: 0 }
    const sleeps = []
    const fail = (label, times) => async () => {
      calls[label] += 1
      if (calls[label] <= times) throw new Error('HTTP 404 while checking published artifact')
    }
    const result = await pollAllVisible(
      [
        { label: 'a', verify: fail('a', 0) },
        { label: 'b', verify: fail('b', 1) },
        { label: 'c', verify: fail('c', 2) },
      ],
      {
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        now: () => 0,
      },
    )
    expect(result).toEqual({ visible: ['a', 'b', 'c'], pending: [] })
    expect(calls).toEqual({ a: 1, b: 2, c: 3 })
    expect(sleeps).toEqual([30_000, 60_000])
  })

  // Safety limit (D121 clarification, RLF-SAFELIMITS): a registry that
  // never shows the artifacts pends every one after the shared 30-minute
  // budget instead of polling until the job's own timeout fails it, and
  // every round names the still-pending labels.
  it('pends a never-visible registry after the shared 30-minute budget', async () => {
    let slept = 0
    let now = 0
    const lines = []
    const result = await pollAllVisible(
      [
        { label: 'a', verify: neverVisible },
        { label: 'b', verify: neverVisible },
      ],
      {
        sleep: async (ms) => {
          slept += ms
          now += ms
        },
        now: () => now,
        tell: (line) => {
          lines.push(line)
        },
      },
    )
    expect(result).toEqual({ visible: [], pending: ['a', 'b'] })
    expect(slept).toBeGreaterThanOrEqual(30 * 60_000)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toContain('a')
      expect(line).toContain('b')
    }
  })

  it('still resolves a registry visible inside the budget, like npm at 19 minutes', async () => {
    let slept = 0
    let now = 0
    const slow = async () => {
      if (slept < 19 * 60_000) throw new Error('HTTP 404 while checking published artifact')
    }
    const result = await pollAllVisible(
      [
        { label: 'a', verify: slow },
        { label: 'b', verify: slow },
      ],
      {
        sleep: async (ms) => {
          slept += ms
          now += ms
        },
        now: () => now,
      },
    )
    expect(result).toEqual({ visible: ['a', 'b'], pending: [] })
    expect(slept).toBeGreaterThanOrEqual(19 * 60_000)
  })

  it('shares one stop across artifacts instead of one per artifact', async () => {
    const stop = new globalThis.AbortController()
    let rounds = 0
    const result = await pollAllVisible(
      [
        { label: 'a', verify: neverVisible },
        { label: 'b', verify: neverVisible },
        { label: 'c', verify: neverVisible },
      ],
      {
        sleep: async () => {
          rounds += 1
          if (rounds === 2) stop.abort()
        },
        now: () => 0,
        signal: stop.signal,
      },
    )
    expect(result).toEqual({ visible: [], pending: ['a', 'b', 'c'] })
    expect(rounds).toBe(2)
  })

  it('says what is still pending on every round', async () => {
    const lines = []
    const sleeps = []
    const calls = { alpha: 0, beta: 0 }
    const fail = (label, times) => async () => {
      calls[label] += 1
      if (calls[label] <= times) throw new Error('HTTP 404 while checking published artifact')
    }
    const result = await pollAllVisible(
      [
        { label: 'alpha', verify: fail('alpha', 0) },
        { label: 'beta', verify: fail('beta', 1) },
      ],
      {
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        now: () => 0,
        tell: (line) => {
          lines.push(line)
        },
      },
    )
    expect(result).toEqual({ visible: ['alpha', 'beta'], pending: [] })
    expect(sleeps).toHaveLength(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('beta')
    expect(lines[0]).not.toContain('alpha')
  })

  it('rejects at once on an integrity mismatch instead of polling on', async () => {
    let slept = 0
    await expect(
      pollAllVisible(
        [
          {
            label: 'a',
            verify: async () => {
              throw new Error('marketplace published SHA-256 differs from the release VSIX')
            },
          },
        ],
        {
          sleep: async (ms) => {
            slept += ms
          },
          now: () => 0,
        },
      ),
    ).rejects.toThrow('differs from the release VSIX')
    expect(slept).toBe(0)
  })

  it('refuses an unknown registry before running anything', async () => {
    let ran = 0
    await expect(
      publishOnce(
        'nope',
        'x.vsix',
        {},
        {
          run: () => {
            ran += 1
            return ''
          },
        },
      ),
    ).rejects.toThrow('Unknown registry')
    expect(ran).toBe(0)
  })
})
