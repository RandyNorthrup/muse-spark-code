import { describe, expect, it } from 'vitest'
import { startStillWaiting, stillWaitingText } from '../../src/core/timeouts'

describe('stillWaitingText (NOLIMITS2)', () => {
  it('names what waits and how long, ending with Stop', () => {
    const text = stillWaitingText('MCP server "s" startup', 125_000)
    expect(text).toContain('MCP server "s" startup')
    expect(text).toContain('Stop ends it.')
  })
})

describe('startStillWaiting (NOLIMITS2)', () => {
  it('tells repeatedly with growing elapsed time until stopped', async () => {
    const seen: number[] = []
    const stop = startStillWaiting((elapsedMs) => {
      seen.push(elapsedMs)
    }, 10)
    await new Promise((resolve) => setTimeout(resolve, 45))
    stop()
    expect(seen.length).toBeGreaterThanOrEqual(2)
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!).toBeGreaterThan(seen[index - 1]!)
    }
    const count = seen.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(seen.length).toBe(count)
  })
})
