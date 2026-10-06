import { describe, expect, it } from 'vitest'
import { paidHarness as setup } from './paidHarness'

describe('interactive paid policy apart from ACP flags', () => {
  it('asks once per actual use and counts the real paid usage', async () => {
    const { paid, ask, usage } = setup()
    expect(await paid.allows('/ws', 's', { feature: 'webSearch' }, true)).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(await paid.allows('/ws', 's', { feature: 'webSearch' }, true)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    paid.noteUse('webSearch', 1)
    expect(usage.current.webSearches).toBe(1)
    expect(() => {
      paid.noteUse('webSearch', NaN)
    }).toThrow()
    await paid.dispose()
  })

  it('honours explicit OFF and unavailable key/capability without asking', async () => {
    const { paid, ask, state } = setup()
    state.isOn = false
    expect(await paid.allows('/ws', 's', { feature: 'voice' }, true)).toBe(false)
    state.isOn = true
    state.isAvailable = false
    expect(await paid.allows('/ws', 's', { feature: 'voice' }, true)).toBe(false)
    expect(ask).not.toHaveBeenCalled()
    await paid.dispose()
  })

  it('keeps Always workspace-scoped and revokes every setting that turns off', async () => {
    const { paid, ask, state, granted } = setup()
    ask.mockResolvedValue('always')
    const request = { feature: 'voice' } as const
    expect(await paid.allows('/one', 's', request, false)).toBe(true)
    expect(await paid.allows('/one', 's', request, false)).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(await paid.allows('/two', 's', request, false)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(paid.isRemembered('/one', 'voice')).toBe(true)
    state.isOn = false
    await paid.forgetUnflagged()
    expect(granted.get('/one')?.has('voice')).toBe(false)
    state.isOn = true
    expect(paid.isRemembered('/one', 'voice')).toBe(false)
    await paid.dispose()
  })

  it('ignores a remembered grant in an untrusted workspace', async () => {
    const { paid, ask, state, granted } = setup()
    granted.set('/ws', new Set(['webSearch']))
    state.canRemember = false
    ask.mockResolvedValue('deny')
    expect(await paid.allows('/ws', 's', { feature: 'webSearch' }, true)).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    await paid.dispose()
  })

  it('rejects a late Always answer after owner replacement without retaining a grant', async () => {
    const { paid, ask, state, grants } = setup()
    const held = Promise.withResolvers<'always'>()
    ask.mockReturnValue(held.promise)
    const deciding = paid.allows('/ws', 's', { feature: 'voice' }, true)
    state.isCurrent = false
    held.resolve('always')
    expect(await deciding).toBe(false)
    expect(grants.add).not.toHaveBeenCalled()
    await paid.dispose()
  })

  it('cancels an unanswered popup and drains decisions before release', async () => {
    const { paid, ask } = setup()
    const held = Promise.withResolvers<'once'>()
    ask.mockReturnValue(held.promise)
    const deciding = paid.allows('/ws', 's', { feature: 'voice' }, true)
    const closing = paid.dispose()
    expect(paid.dispose()).toBe(closing)
    expect(paid.isOn('voice')).toBe(false)
    expect(await deciding).toBe(false)
    await closing
    held.resolve('once')
    expect(await paid.allows('/ws', 's', { feature: 'voice' }, true)).toBe(false)
  })
})
