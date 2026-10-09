import { describe, expect, it } from 'vitest'
import { paidHarness as setup } from './paidHarness'

describe('interactive paid policy apart from ACP flags', () => {
  it('snoozes Denied Tab only in its window', async () => {
    const { paid, ask } = setup()
    const request = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 } as const
    ask.mockResolvedValueOnce('deny')
    expect(await paid.allows('/ws', 'denied-window', request, false)).toBe(false)
    expect(await paid.allows('/ws', 'denied-window', request, false)).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    expect(await paid.allows('/ws', 'other-window', request, false)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    await paid.dispose()
  })

  it('revokes Tab once on OFF while retaining it across another feature’s toggle', async () => {
    const { paid, ask } = setup(undefined, undefined, { confirm: () => Promise.resolve(true) })
    const request = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 } as const
    const composition = paid.composition('/ws', 'window')
    expect(await composition.consent.allows(request)).toBe(true)
    await composition.gate.turnOff('voice')
    expect(await composition.consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    await composition.gate.turnOff('tab')
    expect(await composition.consent.allows(request)).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    expect(await composition.gate.turnOn('tab')).toBe(true)
    expect(await composition.consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    await paid.dispose()
  })

  it('discards an old Always answer after workspace Ask again', async () => {
    const { paid, ask, grants } = setup()
    const held = Promise.withResolvers<'always'>()
    ask.mockReturnValue(held.promise)
    const composition = paid.composition('/ws', 'window')
    const pending = composition.consent.allows({ feature: 'voice' })
    await composition.consent.forget()
    held.resolve('always')
    expect(await pending).toBe(false)
    expect(grants.add).not.toHaveBeenCalled()
    await paid.dispose()
  })

  it('keeps Tab Allow once for exactly its window and revokes it with Ask again', async () => {
    const { paid, ask } = setup()
    const request = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 } as const
    const first = paid.composition('/ws', 'window-one')
    expect(await first.consent.allows(request)).toBe(true)
    expect(await first.consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(await paid.composition('/ws', 'window-two').consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    await first.consent.forget()
    expect(await first.consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(3)
    await paid.dispose()
    const next = setup()
    expect(await next.paid.composition('/ws', 'window-one').consent.allows(request)).toBe(true)
    expect(next.ask).toHaveBeenCalledOnce()
    await next.paid.dispose()
  })

  it('shares a pending Tab question in one window without authorizing another window', async () => {
    const { paid, ask } = setup()
    const held = Promise.withResolvers<'once'>()
    ask.mockReturnValue(held.promise)
    const request = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 } as const
    const first = paid.allows('/ws', 'window-one', request, false)
    const second = paid.allows('/ws', 'window-one', request, false)
    try {
      expect(ask).toHaveBeenCalledOnce()
      held.resolve('once')
      expect(await Promise.all([first, second])).toEqual([true, true])
      expect(await paid.allows('/ws', 'window-two', request, false)).toBe(true)
      expect(ask).toHaveBeenCalledTimes(2)
    } finally {
      held.resolve('once')
      await Promise.allSettled([first, second])
      await paid.dispose()
    }
  })

  it('binds v2 controller consent, revocation and Best-of-N to the actual policy', async () => {
    const { paid, ask, usage, granted } = setup([], () => 0.25)
    const composition = paid.composition('/ws', 'surface')
    ask.mockResolvedValue('always')
    // An unavailable feature still refuses through the contributed port.
    expect(
      await composition.consent.allows({
        feature: 'bestOfN',
        modelId: 'verified',
        prompt: 'task',
        attempts: 2,
        requestCeilingPerAttempt: 1,
      }),
    ).toBe(false)
    expect(ask).not.toHaveBeenCalled()
    composition.usage.addBestOfNRequest()
    composition.usage.addBestOfNUsage('verified', {
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 0,
    })
    expect(usage.current.bestOfNRequests).toBe(1)
    expect(usage.current.bestOfNCostUsd).toBe(0.25)
    granted.set('/ws', new Set(['bestOfN']))
    granted.set('/other', new Set(['voice']))
    await composition.consent.forget()
    expect(granted.get('/ws')).toBeUndefined()
    expect(granted.get('/other')?.has('voice')).toBe(true)
    await paid.dispose()
    await expect(composition.gate.turnOn('bestOfN')).rejects.toThrow()
  })

  it('honours Always on the v2 ordinary consent port and revokes it when toggled off', async () => {
    const { paid, ask, granted } = setup()
    const composition = paid.composition('/ws', 'surface')
    ask.mockResolvedValue('always')
    expect(await composition.consent.allows({ feature: 'webSearch' })).toBe(true)
    expect(await composition.consent.allows({ feature: 'webSearch' })).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    await composition.gate.turnOff('webSearch')
    expect(granted.get('/ws')?.has('webSearch')).toBe(false)
    await paid.dispose()
  })

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

  it('refuses an in-hand Always answer when Ask again queues behind a settings write', async () => {
    const releaseSetting = Promise.withResolvers<undefined>()
    const { paid, ask, grants } = setup(undefined, undefined, {
      setSetting: () => releaseSetting.promise,
    })
    const composition = paid.composition('/ws', 'window')
    const turningOff = composition.gate.turnOff('webSearch')
    const held = Promise.withResolvers<'always'>()
    ask.mockReturnValue(held.promise)
    const deciding = composition.consent.allows({ feature: 'voice' })
    const forgetting = composition.consent.forget()
    held.resolve('always')
    releaseSetting.resolve(undefined)
    expect(await deciding).toBe(false)
    expect(grants.add).not.toHaveBeenCalled()
    await expect(turningOff).rejects.toThrow('MHP_PAID_OWNER_REPLACED')
    await forgetting
    await paid.dispose()
  })

  it('refuses an in-hand Allow once answer when Ask again queues behind a settings write', async () => {
    const releaseSetting = Promise.withResolvers<undefined>()
    const { paid, ask, grants } = setup(undefined, undefined, {
      setSetting: () => releaseSetting.promise,
    })
    const composition = paid.composition('/ws', 'window')
    const turningOff = composition.gate.turnOff('webSearch')
    const held = Promise.withResolvers<'once'>()
    ask.mockReturnValue(held.promise)
    const request = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 } as const
    const deciding = composition.consent.allows(request)
    const forgetting = composition.consent.forget()
    held.resolve('once')
    releaseSetting.resolve(undefined)
    expect(await deciding).toBe(false)
    expect(grants.add).not.toHaveBeenCalled()
    await expect(turningOff).rejects.toThrow('MHP_PAID_OWNER_REPLACED')
    await forgetting
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
