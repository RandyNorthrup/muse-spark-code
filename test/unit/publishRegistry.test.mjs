import { describe, expect, it } from 'vitest'
import { pollAllVisible, publishOnce } from '../../scripts/publish-registry.mjs'

async function neverVisible() {
  throw new Error('HTTP 404 while checking published artifact')
}

// The release publishes every artifact first and only then polls for
// visibility under one shared deadline (PLAN.md D123): a slow registry
// delays the job once instead of once per artifact, and an unfinished
// target is re-checked in the same job rather than left unpublished.
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
        timeoutMs: 1_800_000,
      },
    )
    expect(result).toEqual({ visible: ['a', 'b', 'c'], pending: [] })
    expect(calls).toEqual({ a: 1, b: 2, c: 3 })
    expect(sleeps).toEqual([30_000, 60_000])
  })

  it('shares one deadline across artifacts instead of one per artifact', async () => {
    let slept = 0
    const result = await pollAllVisible(
      [
        { label: 'a', verify: neverVisible },
        { label: 'b', verify: neverVisible },
        { label: 'c', verify: neverVisible },
      ],
      {
        sleep: async (ms) => {
          slept += ms
        },
        now: () => 0,
        timeoutMs: 90_000,
      },
    )
    expect(result).toEqual({ visible: [], pending: ['a', 'b', 'c'] })
    expect(slept).toBe(90_000)
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
          timeoutMs: 90_000,
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
