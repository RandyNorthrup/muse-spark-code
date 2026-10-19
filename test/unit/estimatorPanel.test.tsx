// @vitest-environment jsdom
// The estimator panel's run boundary (D119): the estimator's own refusal
// keeps its detail in the panel's words; anything else reads failed and
// keeps its kind past the panel for the host log.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { lookupEstimatePrices } from '../../src/core/estimator/prices'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import EstimatorPanel, { type EstimatorPanelPort } from '../../src/webview/estimator/EstimatorPanel'
import type { EstimateViewState } from '../../src/shared/estimateDiagnostic'
import {
  ESTIMATE_AS_OF,
  estimateContractFailure,
  estimatePricePorts,
} from './helpers/estimateFailures'

afterEach(cleanup)

function duplicateLookup() {
  return {
    asOf: ESTIMATE_AS_OF,
    enabled: true,
    networkAllowed: false,
    maxAgeMs: 60_000,
    catalogUrls: ['https://example.com/a.json', 'https://example.com/a.json'],
  } as const
}

/** The panel's section subscription, collected so the test owns its lifetime. */
function collectSections() {
  const listeners: ((state: EstimateViewState) => void)[] = []
  return {
    subscribe: (listener: (state: EstimateViewState) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index !== -1) listeners.splice(index, 1)
      }
    },
  }
}

function renderPanel(
  estimate: EstimatorPanelPort['estimate'],
  report: EstimatorPanelPort['report'],
) {
  render(
    <EstimatorPanel
      port={{
        context: () => ({ asOf: ESTIMATE_AS_OF, optimize: 'cost' }),
        estimate,
        subscribe: collectSections().subscribe,
        report,
        provision: { state: 'waiting', dependency: 'M117-W-M96-board' },
      }}
      initial={{
        goal: { kind: 'milestone', milestoneId: 'M117' },
        asOf: ESTIMATE_AS_OF,
        fleet: 'current',
        optimize: 'cost',
      }}
    />,
  )
}

/** Render the panel with a recording host-log report; the test owns both. */
function renderPanelWithReport(estimate: EstimatorPanelPort['estimate']) {
  const reported: unknown[] = []
  renderPanel(estimate, (error) => {
    reported.push(error)
  })
  return reported
}

describe('estimator panel run boundary', () => {
  it('says the estimator’s own refusal in its own words', async () => {
    setUiText(EN, BASE_LOCALE)
    const reported = renderPanelWithReport(() =>
      lookupEstimatePrices(duplicateLookup(), estimatePricePorts()),
    )
    fireEvent.click(screen.getByRole('button'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fill(UI_TEXT.estimateFailed, { detail: 'catalog-options' }))
    // The panel's own refusal never reaches the host log: it said everything.
    expect(reported).toEqual([])
  })

  it('reads a foreign failure as failed, without its raw text', async () => {
    setUiText(EN, BASE_LOCALE)
    const foreign = estimateContractFailure()
    const reported = renderPanelWithReport(() => Promise.reject(foreign))
    fireEvent.click(screen.getByRole('button'))
    // The panel says failed in words, never the contract failure's raw
    // text. The failure itself keeps its kind past the panel (the port's
    // report): the host hands it to the host log, and the catch gate reads
    // that path as the recorded one.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
    expect(reported).toHaveLength(1)
    expect(reported[0]).toBe(foreign)
  })
})
