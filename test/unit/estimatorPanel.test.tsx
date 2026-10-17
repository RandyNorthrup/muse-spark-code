// @vitest-environment jsdom
// The estimator panel's run boundary (D119): the estimator's own refusal
// keeps its detail in the panel's words; anything else reads failed and
// keeps its kind past the panel for the host log.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { lookupEstimatePrices } from '../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../src/host/estimator/localFleet'
import { estimateSectionSchema } from '../../src/shared/estimate'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import EstimatorPanel from '../../src/webview/estimator/EstimatorPanel'

afterEach(cleanup)

const AS_OF = '2026-10-17T00:00:00.000Z'

function pricePorts() {
  return estimatorSourcePorts(() => ({
    enabled: true,
    networkAllowed: false,
    maxAgeMs: 60_000,
    catalogUrls: [],
  })).prices()
}

function duplicateLookup() {
  return {
    asOf: AS_OF,
    enabled: true,
    networkAllowed: false,
    maxAgeMs: 60_000,
    catalogUrls: ['https://example.com/a.json', 'https://example.com/a.json'],
  } as const
}

function contractFailure(): Error {
  try {
    estimateSectionSchema.parse({})
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('section schema accepted an empty object')
}

/** The panel's section subscription, collected so the test owns its lifetime. */
function collectSections() {
  const listeners: ((section: unknown) => void)[] = []
  return {
    subscribe: (listener: (section: unknown) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index !== -1) listeners.splice(index, 1)
      }
    },
  }
}

describe('estimator panel run boundary', () => {
  it('says the estimator’s own refusal in its own words', async () => {
    setUiText(EN, BASE_LOCALE)
    render(
      <EstimatorPanel
        port={{
          context: () => ({ asOf: AS_OF, optimize: 'cost' }),
          estimate: () => lookupEstimatePrices(duplicateLookup(), pricePorts()),
          subscribe: collectSections().subscribe,
          provision: { state: 'waiting', dependency: 'M117-W-M96-board' },
        }}
        initial={{
          goal: { kind: 'milestone', milestoneId: 'M117' },
          asOf: AS_OF,
          fleet: 'current',
          optimize: 'cost',
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fill(UI_TEXT.estimateFailed, { detail: 'catalog-options' }))
  })

  it('reads a foreign failure as failed, without its raw text', async () => {
    setUiText(EN, BASE_LOCALE)
    const foreign = contractFailure()
    render(
      <EstimatorPanel
        port={{
          context: () => ({ asOf: AS_OF, optimize: 'cost' }),
          estimate: () => Promise.reject(foreign),
          subscribe: collectSections().subscribe,
          provision: { state: 'waiting', dependency: 'M117-W-M96-board' },
        }}
        initial={{
          goal: { kind: 'milestone', milestoneId: 'M117' },
          asOf: AS_OF,
          fleet: 'current',
          optimize: 'cost',
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    // The panel says failed in words, never the contract failure's raw
    // text. The failure itself keeps its kind past the panel (`throw
    // error`): in the document the window hooks hand it to the host log,
    // and the catch gate reads that path as the recorded one.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
  })
})
