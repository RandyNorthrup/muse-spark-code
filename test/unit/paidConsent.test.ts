import { describe, expect, it, vi } from 'vitest'
import { PaidUseConsent, type PaidUseAnswer } from '../../src/core/paid/paidConsent'
import type { PaidFeature } from '../../src/shared/constants'
import type { PaidUseRequest } from '../../src/shared/paid'
import { FakeLogOutputChannel } from './helpers/fakes'

function consentWith(
  options: {
    on?: readonly PaidFeature[]
    grants?: readonly PaidFeature[]
    canRemember?: boolean
    answer?: (request: PaidUseRequest, canRemember: boolean) => Promise<PaidUseAnswer>
  } = {},
) {
  const on = new Set(options.on ?? ['webSearch'])
  let grants = new Set(options.grants)
  const writes: (readonly PaidFeature[])[] = []
  const ask = vi.fn(options.answer ?? (() => Promise.resolve<PaidUseAnswer>('once')))
  const consent = new PaidUseConsent({
    isOn: (feature) => on.has(feature),
    canRemember: () => options.canRemember ?? true,
    readGrants: () => grants,
    writeGrants: (next) => {
      grants = new Set(next)
      writes.push([...next])
      return Promise.resolve()
    },
    ask,
    log: new FakeLogOutputChannel(),
  })
  return { consent, ask, on, writes, grants: () => grants }
}

const SEARCH: PaidUseRequest = { feature: 'webSearch' }

describe('PaidUseConsent (M58)', () => {
  it('lets an "always" it cannot keep go ahead once, and says so', async () => {
    const log = new FakeLogOutputChannel()
    const consent = new PaidUseConsent({
      isOn: () => true,
      canRemember: () => true,
      readGrants: () => new Set(),
      writeGrants: () => Promise.reject(new Error('storage is full')),
      ask: () => Promise.resolve('always'),
      log,
    })
    await expect(consent.allows(SEARCH)).resolves.toBe(true)
    expect(log.warn).toHaveBeenCalledWith(
      'Paid use of webSearch: "always" could not be kept, so it is allowed once: storage is full',
    )
    expect(log.info).toHaveBeenLastCalledWith('Paid use of webSearch: allowed once')
  })

  it('refuses a feature that is off without asking', async () => {
    const t = consentWith({ on: [] })
    await expect(t.consent.allows(SEARCH)).resolves.toBe(false)
    expect(t.ask).not.toHaveBeenCalled()
  })

  it('asks each time for "once", and nothing is kept', async () => {
    const t = consentWith()
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    expect(t.ask).toHaveBeenCalledTimes(2)
    expect(t.ask).toHaveBeenCalledWith(SEARCH, true)
    expect(t.writes).toEqual([])
  })

  it('refuses on Deny', async () => {
    const t = consentWith({ answer: () => Promise.resolve('deny') })
    await expect(t.consent.allows(SEARCH)).resolves.toBe(false)
    expect(t.writes).toEqual([])
  })

  it('keeps "always", then stops asking and tells its listeners', async () => {
    const t = consentWith({ answer: () => Promise.resolve('always') })
    const listener = vi.fn()
    t.consent.onDidChange(listener)
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    expect(t.writes).toEqual([['webSearch']])
    expect(listener).toHaveBeenCalledTimes(1)
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    expect(t.ask).toHaveBeenCalledTimes(1)
    expect(t.consent.remembered()).toEqual(['webSearch'])
  })

  it('asks despite "always" when the use demands a question', async () => {
    const t = consentWith({ grants: ['webSearch'], answer: () => Promise.resolve('deny') })
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    await expect(t.consent.allows(SEARCH, true)).resolves.toBe(false)
    expect(t.ask).toHaveBeenCalledTimes(1)
  })

  it('refuses a use whose feature was turned off while the popup was open', async () => {
    const holder: { t?: ReturnType<typeof consentWith> } = {}
    const t = consentWith({
      answer: () => {
        holder.t?.on.delete('webSearch')
        return Promise.resolve('always')
      },
    })
    holder.t = t
    await expect(t.consent.allows(SEARCH)).resolves.toBe(false)
    expect(t.writes).toEqual([])
  })

  it('never keeps or honours "always" where it cannot be kept', async () => {
    const t = consentWith({
      grants: ['webSearch'],
      canRemember: false,
      answer: () => Promise.resolve('always'),
    })
    expect(t.consent.isRemembered('webSearch')).toBe(false)
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    expect(t.ask).toHaveBeenCalledWith(SEARCH, false)
    expect(t.writes).toEqual([])
  })

  it('forgets every grant on "Ask again", and does nothing when there is none', async () => {
    const t = consentWith({ on: ['webSearch', 'voice'], grants: ['webSearch', 'voice'] })
    const listener = vi.fn()
    t.consent.onDidChange(listener)
    await t.consent.forget()
    expect(t.writes).toEqual([[]])
    expect(listener).toHaveBeenCalledTimes(1)
    await t.consent.forget()
    expect(t.writes).toEqual([[]])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
