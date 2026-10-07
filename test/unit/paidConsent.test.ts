import { describe, expect, it, vi } from 'vitest'
import {
  PaidUseConsent,
  paidUseQuestion,
  type PaidUseAnswer,
} from '../../src/core/paid/paidConsent'
import { UI_TEXT, type PaidFeature } from '../../src/shared/constants'
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

  it('ends a signaled wait on Stop while preserving the shared unanswered popup', async () => {
    const answer = Promise.withResolvers<PaidUseAnswer>()
    const t = consentWith({ answer: () => answer.promise })
    const stop = new AbortController()
    const remove = vi.spyOn(stop.signal, 'removeEventListener')
    const waiting = t.consent.allows(SEARCH, false, stop.signal)
    const failed = expect(waiting).rejects.toThrow('stopped')
    stop.abort(new Error('stopped'))
    await failed
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(t.writes).toEqual([])
    answer.resolve('always')
    await expect(t.consent.allows(SEARCH)).resolves.toBe(true)
    expect(t.grants()).toEqual(new Set(['webSearch']))
  })

  it('does not open a popup for an already stopped caller', async () => {
    const t = consentWith()
    const stop = new AbortController()
    stop.abort(new Error('already stopped'))
    await expect(t.consent.allows(SEARCH, false, stop.signal)).rejects.toThrow('already stopped')
    expect(t.ask).not.toHaveBeenCalled()
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

const TAB_REQUEST: PaidUseRequest = { feature: 'tab', modelId: 'muse-spark-1.3', budgetUsd: 1 }

/** A consent over in-memory settings and grants, with a scripted popup. */
function tabConsentWith(
  options: {
    on?: readonly PaidFeature[]
    grants?: readonly PaidFeature[]
    answers?: readonly PaidUseAnswer[]
    canRemember?: boolean
    windowOnce?: readonly PaidFeature[]
    /** The shared price-acceptance generation every window reads. */
    generation?: { value: number }
  } = {},
) {
  const on = new Set<PaidFeature>(options.on ?? ['tab'])
  const { generation } = options
  let grants = new Set<PaidFeature>(options.grants)
  const answers = [...(options.answers ?? [])]
  const asked: PaidUseRequest[] = []
  const consent = new PaidUseConsent({
    isOn: (feature) => on.has(feature),
    ...(options.windowOnce !== undefined && {
      windowOnceFeatures: new Set(options.windowOnce),
    }),
    ...(generation !== undefined && { windowOnceGeneration: () => generation.value }),
    canRemember: () => options.canRemember ?? false,
    readGrants: () => grants,
    writeGrants: (next) => {
      grants = new Set(next)
      return Promise.resolve()
    },
    ask: (request) => {
      asked.push(request)
      return Promise.resolve(answers.shift() ?? 'deny')
    },
    log: new FakeLogOutputChannel(),
  })
  const changes = vi.fn()
  consent.onDidChange(changes)
  return { consent, on, grants: () => grants, asked, changes }
}

describe('paidUseQuestion: Tab (M94 lane L, PLAN.md D73)', () => {
  it('names Tab, the model, its rates and today’s budget', async () => {
    const question = await paidUseQuestion(TAB_REQUEST)
    expect(question.title).toBe(UI_TEXT.paidUseTabTitle)
    expect(question.detail).toContain('muse-spark-1.3')
    expect(question.detail).toContain('$1.250/1M input')
    expect(question.detail).toContain('$1.00')
    expect(question.detail).toContain('Allow once covers this window until it closes')
  })

  it('adds the training note for the contributor model only', async () => {
    const contributor = await paidUseQuestion({
      feature: 'tab',
      modelId: 'muse-spark-1.3-contributor',
      budgetUsd: 1,
    })
    expect(contributor.detail).toContain('muse-spark-1.3-contributor')
    expect(contributor.detail).toContain('$0.100/1M input')
    expect(contributor.detail).toContain(UI_TEXT.tabTrainingContributor)
    const standard = await paidUseQuestion(TAB_REQUEST)
    expect(standard.detail).not.toContain('trains on')
  })

  it('has no rate to quote for an unpriced model', async () => {
    await expect(
      paidUseQuestion({ feature: 'tab', modelId: 'muse-spark-future', budgetUsd: 1 }),
    ).rejects.toThrow(UI_TEXT.subagentTariffUnknown)
  })
})

describe('window-scoped Allow once (M94 Q-M94a)', () => {
  it('covers the window after one answer, and asks other features every time', async () => {
    const tab = tabConsentWith({ windowOnce: ['tab'], answers: ['once'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    expect(tab.asked).toHaveLength(1)
    expect(tab.grants().size).toBe(0)
    // "Allow once" for a feature without window scope still asks every time.
    const voice = tabConsentWith({ on: ['voice'], answers: ['once', 'once'] })
    await expect(voice.consent.allows({ feature: 'voice' })).resolves.toBe(true)
    await expect(voice.consent.allows({ feature: 'voice' })).resolves.toBe(true)
    expect(voice.asked).toHaveLength(2)
  })

  it('asks again when the use demands a question', async () => {
    const tab = tabConsentWith({ windowOnce: ['tab'], answers: ['once', 'deny'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    await expect(tab.consent.allows(TAB_REQUEST, true)).resolves.toBe(false)
    expect(tab.asked).toHaveLength(2)
  })

  it('denies, and refuses a feature turned off while the popup was open', async () => {
    const tab = tabConsentWith({ windowOnce: ['tab'], answers: ['deny'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(false)
    const off = tabConsentWith({ windowOnce: ['tab'], answers: ['once'] })
    off.on.delete('tab')
    await expect(off.consent.allows(TAB_REQUEST)).resolves.toBe(false)
  })

  it('does not persist past the window: a new instance asks again', async () => {
    // The same shared generation throughout: only the window's memory is new.
    const generation = { value: 3 }
    const first = tabConsentWith({ windowOnce: ['tab'], generation, answers: ['once'] })
    await expect(first.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    expect(first.grants().size).toBe(0)
    const second = tabConsentWith({ windowOnce: ['tab'], generation, answers: ['deny'] })
    await expect(second.consent.allows(TAB_REQUEST)).resolves.toBe(false)
    expect(second.asked).toHaveLength(1)
  })

  it('holds only while the price acceptance it was given under is current (RVM94LC finding 7)', async () => {
    const generation = { value: 0 }
    const tab = tabConsentWith({ windowOnce: ['tab'], generation, answers: ['once', 'deny'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    expect(tab.asked).toHaveLength(1)
    // Another window withdrew the price and accepted it again.
    generation.value = 2
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(false)
    expect(tab.asked).toHaveLength(2)
  })

  it('asks again after the price acceptance changes', async () => {
    const tab = tabConsentWith({ windowOnce: ['tab'], answers: ['once', 'deny'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    tab.consent.revokeWindowOnce('tab')
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(false)
    expect(tab.asked).toHaveLength(2)
  })

  it('asks again after "Ask again"', async () => {
    const tab = tabConsentWith({ windowOnce: ['tab'], answers: ['once', 'once'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    await tab.consent.forget()
    expect(tab.changes).toHaveBeenCalled()
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    expect(tab.asked).toHaveLength(2)
  })

  it('shares one first question between concurrent uses (RVM94LC finding 6)', async () => {
    for (const [answer, expected] of [
      ['once', true],
      ['deny', false],
    ] as const) {
      // A popup that stays open until the test answers it.
      const answers: ((value: PaidUseAnswer) => void)[] = []
      const ask = vi.fn(
        () =>
          new Promise<PaidUseAnswer>((resolve) => {
            answers.push(resolve)
          }),
      )
      const consent = new PaidUseConsent({
        isOn: () => true,
        windowOnceFeatures: new Set<PaidFeature>(['tab']),
        canRemember: () => false,
        readGrants: () => new Set(),
        writeGrants: () => Promise.resolve(),
        ask,
        log: new FakeLogOutputChannel(),
      })
      // Two first Tab uses before either popup is answered: one question.
      const first = consent.allows(TAB_REQUEST)
      const second = consent.allows(TAB_REQUEST)
      expect(ask).toHaveBeenCalledTimes(1)
      // A use that requires asking keeps its own question.
      const demanded = consent.allows(TAB_REQUEST, true)
      expect(ask).toHaveBeenCalledTimes(2)
      answers[0]?.(answer)
      await expect(Promise.all([first, second])).resolves.toEqual([expected, expected])
      answers[1]?.('deny')
      await expect(demanded).resolves.toBe(false)
      expect(ask).toHaveBeenCalledTimes(2)
      // The question is closed: after Allow once the window is covered,
      // after Deny the next use asks anew.
      const later = consent.allows(TAB_REQUEST)
      expect(ask).toHaveBeenCalledTimes(expected ? 2 : 3)
      answers[2]?.('deny')
      await expect(later).resolves.toBe(expected)
    }
  })

  it('keeps "Allow always" workspace-scoped for a window-once feature', async () => {
    const tab = tabConsentWith({ windowOnce: ['tab'], canRemember: true, answers: ['always'] })
    await expect(tab.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    expect(tab.grants().has('tab')).toBe(true)
    // The grant is kept per workspace: the same store asks nothing.
    const same = tabConsentWith({
      windowOnce: ['tab'],
      canRemember: true,
      grants: [...tab.grants()],
      answers: ['deny'],
    })
    await expect(same.consent.allows(TAB_REQUEST)).resolves.toBe(true)
    expect(same.asked).toHaveLength(0)
    expect(same.consent.isRemembered('tab')).toBe(true)
  })
})
