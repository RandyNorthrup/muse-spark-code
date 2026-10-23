import { describe, expect, it } from 'vitest'
import {
  createTabConsent,
  tabPriceFingerprint,
  type TabConsentDeps,
  type TabConsentGrant,
  type TabConsentScope,
  type TabUseConsent,
} from '../../src/host/tab/tabConsent'
import { queuedTabAsk } from './helpers/tabQuietFixtures'

// M94 acceptance 11 (the first request asks; Allow once covers the window;
// Always persists for the workspace and is voided by a price change; Deny
// snoozes) with the keyed-consent semantics (RVM94KR2): one key per
// (model, price). The paid gate behind the question is an in-memory seam;
// the consent, its record parsing and its revocation binding are real.

const MODEL = 'muse-spark-1.3'
const OTHER_MODEL = 'muse-spark-1.3-contributor'

interface GateState {
  isOn: boolean
  isRemembered: boolean
  windowToken: string | undefined
  revocations: number
  stored: unknown
  answers: (TabConsentScope | undefined)[]
  asked: string[]
  prices: Map<string, string>
  warns: string[]
}

function gateOf(): { state: GateState; deps: TabConsentDeps; consent: TabUseConsent } {
  const state: GateState = {
    isOn: true,
    isRemembered: false,
    windowToken: 'token-1',
    revocations: 0,
    stored: undefined,
    answers: [],
    asked: [],
    prices: new Map([
      [MODEL, 'price-a'],
      [OTHER_MODEL, 'price-b'],
    ]),
    warns: [],
  }
  const deps: TabConsentDeps = {
    priceOf: (model) => state.prices.get(model),
    ask: queuedTabAsk(state.asked, state.answers),
    isOn: () => state.isOn,
    isRemembered: () => state.isRemembered,
    windowOnceToken: () => state.windowToken,
    revocations: () => state.revocations,
    readAlways: () => state.stored,
    writeAlways: (record) => {
      state.stored = record
      return Promise.resolve()
    },
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: (message) => void state.warns.push(message),
      error: () => undefined,
    },
  }
  return { state, deps, consent: createTabConsent(deps) }
}

/** A voided grant asks again and the re-ask grants once, the second question. */
async function expectOnceAfterVoid(
  gate: { state: GateState; consent: TabUseConsent },
  grant: TabConsentGrant | undefined,
): Promise<void> {
  expect(grant?.isCurrent()).toBe(false)
  const next = await gate.consent.requestUse(MODEL)
  expect(next?.scope).toBe('once')
  expect(gate.state.asked).toEqual([MODEL, MODEL])
}

describe('tabPriceFingerprint', () => {
  it('fingerprints priced models and refuses unpriced ones', () => {
    expect(tabPriceFingerprint(MODEL)).toBeDefined()
    expect(tabPriceFingerprint(OTHER_MODEL)).toBeDefined()
    expect(tabPriceFingerprint(MODEL)).not.toBe(tabPriceFingerprint(OTHER_MODEL))
    expect(tabPriceFingerprint('no-such-model')).toBeUndefined()
  })
})

describe('createTabConsent', () => {
  it('sends nothing unpriced or off, without asking', async () => {
    const priced = gateOf()
    priced.state.prices.delete(MODEL)
    await expect(priced.consent.requestUse(MODEL)).resolves.toBeUndefined()
    expect(priced.state.asked).toEqual([])
    const off = gateOf()
    off.state.isOn = false
    await expect(off.consent.requestUse(MODEL)).resolves.toBeUndefined()
    expect(off.state.asked).toEqual([])
  })

  it('asks the first request; Deny sends nothing and asks again next time', async () => {
    const { state, consent } = gateOf()
    state.answers.push(undefined, 'once')
    await expect(consent.requestUse(MODEL)).resolves.toBeUndefined()
    const grant = await consent.requestUse(MODEL)
    expect(grant?.scope).toBe('once')
    expect(grant?.isCurrent()).toBe(true)
    expect(state.asked).toEqual([MODEL, MODEL])
  })

  it('covers the window on Allow once, and asks another model on its own key', async () => {
    const { state, consent } = gateOf()
    state.answers.push('window', 'window')
    const grant = await consent.requestUse(MODEL)
    expect(grant?.scope).toBe('window')
    expect(grant?.isCurrent()).toBe(true)
    // The same key answers from the window grant: no second question.
    const again = await consent.requestUse(MODEL)
    expect(again?.scope).toBe('window')
    // Another model asks on its own key.
    const other = await consent.requestUse(OTHER_MODEL)
    expect(other?.scope).toBe('window')
    expect(state.asked).toEqual([MODEL, OTHER_MODEL])
  })

  it('drops the window grant when its token is revoked', async () => {
    const { state, consent } = gateOf()
    state.answers.push('window', 'once')
    const grant = await consent.requestUse(MODEL)
    expect(grant?.isCurrent()).toBe(true)
    state.windowToken = 'token-2'
    await expectOnceAfterVoid({ state, consent }, grant)
  })

  it('persists Always for the workspace; a new window asks nothing', async () => {
    const { state, deps } = gateOf()
    const first = createTabConsent(deps)
    state.answers.push('always')
    state.isRemembered = true
    const grant = await first.requestUse(MODEL)
    expect(grant?.scope).toBe('always')
    expect(grant?.isCurrent()).toBe(true)
    expect(state.stored).toEqual({ scope: 'always', model: MODEL, price: 'price-a' })
    // A new window over the same workspace state asks nothing.
    const second = createTabConsent(deps)
    const kept = await second.requestUse(MODEL)
    expect(kept?.scope).toBe('always')
    expect(kept?.isCurrent()).toBe(true)
    expect(state.asked).toEqual([MODEL])
  })

  it('voids Always when the price moves, and asks again', async () => {
    const { state, deps } = gateOf()
    state.answers.push('always', 'once')
    state.isRemembered = true
    const consent = createTabConsent(deps)
    const grant = await consent.requestUse(MODEL)
    expect(grant?.scope).toBe('always')
    state.prices.set(MODEL, 'price-new')
    await expectOnceAfterVoid({ state, consent }, grant)
  })

  it('asks the migration question for a legacy grant with no record; Allow once records nothing', async () => {
    const { state, deps } = gateOf()
    state.isRemembered = true
    state.answers.push('once')
    const first = createTabConsent(deps)
    const grant = await first.requestUse(MODEL)
    expect(grant?.scope).toBe('once')
    expect(state.stored).toBeUndefined()
    // The next window asks again: nothing was recorded.
    const second = createTabConsent(deps)
    state.answers.push('once')
    await second.requestUse(MODEL)
    expect(state.asked).toEqual([MODEL, MODEL])
  })

  it('clears a record left behind a revoked grant before asking', async () => {
    const { state, consent } = gateOf()
    state.stored = { scope: 'always', model: MODEL, price: 'price-a' }
    state.isRemembered = false
    state.answers.push('once')
    await consent.requestUse(MODEL)
    expect(state.stored).toBeUndefined()
    expect(state.asked).toEqual([MODEL])
  })

  it('sends nothing for a question open across a revocation', async () => {
    const { state, deps } = gateOf()
    const consent = createTabConsent({
      ...deps,
      ask: (model) => {
        state.asked.push(model)
        state.revocations += 1
        return Promise.resolve<TabConsentScope>('once')
      },
    })
    const grant = await consent.requestUse(MODEL)
    expect(grant?.isCurrent()).toBe(false)
  })

  it('shares an open question only with its full key', async () => {
    const { state, deps } = gateOf()
    const waiting = Promise.withResolvers<TabConsentScope>()
    const shared = createTabConsent({
      ...deps,
      ask: (model) => {
        state.asked.push(model)
        return model === MODEL ? waiting.promise : Promise.resolve<TabConsentScope>('window')
      },
    })
    const first = shared.requestUse(MODEL)
    const second = shared.requestUse(MODEL)
    const other = await shared.requestUse(OTHER_MODEL)
    expect(other?.scope).toBe('window')
    waiting.resolve('window')
    const [one, two] = await Promise.all([first, second])
    expect(one?.scope).toBe('window')
    expect(two?.scope).toBe('window')
    expect(state.asked).toEqual([MODEL, OTHER_MODEL])
  })

  it('allows once when Always cannot be kept, and says so', async () => {
    const { state, deps } = gateOf()
    const consent = createTabConsent({
      ...deps,
      writeAlways: () => Promise.reject(new Error('disk is gone')),
    })
    state.answers.push('always')
    const grant = await consent.requestUse(MODEL)
    expect(grant?.scope).toBe('once')
    expect(grant?.isCurrent()).toBe(true)
    expect(state.warns).toHaveLength(1)
  })
})
