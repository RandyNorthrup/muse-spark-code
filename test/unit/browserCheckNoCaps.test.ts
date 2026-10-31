import { describe, expect, it } from 'vitest'
import { placeBrowserCall } from '../../src/core/browser/browserTool'
import { createLifetime } from '../../src/core/browser/workLifetime'

function nineClicks(): readonly { kind: 'click'; selector: string }[] {
  return Array.from({ length: 9 }, (_, index) => ({
    kind: 'click',
    selector: `#button-${String(index)}`,
  }))
}

describe('browser check without invented caps (NOLIMITS2 A34)', () => {
  it('takes more steps than the old 8-action cap allowed', () => {
    // Loopback is reached only by an exact dev origin the user configured (M103).
    const placed = placeBrowserCall(
      { url: 'http://localhost:3000/', actions: nineClicks() },
      new Set(['http://localhost:3000']),
    )
    expect(placed.ok).toBe(true)
    if (placed.ok) expect(placed.actions).toHaveLength(9)
  })

  it('a check lifetime with no named deadline outlasts the old 60 s kill', async () => {
    const lifetime = createLifetime(undefined, [], 50)
    expect(lifetime.deadlineAt).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(lifetime.endedBy).toBeUndefined()
    lifetime.end()
    expect(lifetime.endedBy).toBe('ended')
    await lifetime.cleaned
  })

  it('a named deadline still ends a lifetime that names one', async () => {
    const lifetime = createLifetime(20, [], 50)
    expect(lifetime.deadlineAt).toBeGreaterThan(0)
    await lifetime.cleaned
    expect(lifetime.endedBy).toBe('deadline')
  })
})
