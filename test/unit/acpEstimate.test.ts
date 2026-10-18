// The ACP estimate boundary (D119): the estimator's own refusal stays its
// sentence for the agent, anything else keeps its kind past the boundary,
// and cancellation stays cancellation.
import { describe, expect, it } from 'vitest'
import {
  catalogOptionsRefusal,
  ESTIMATE_AS_OF,
  estimateContractFailure,
} from './helpers/estimateFailures'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { createAcpEstimate } from '../../src/acp/estimate'
import type { EstimateRunPort } from '../../src/runtime/estimator/command'

function agent(runner: EstimateRunPort) {
  return createAcpEstimate({
    context: () => ({ asOf: ESTIMATE_AS_OF, optimize: 'cost' }),
    runner: () => runner,
    money: { price: () => '' },
  })
}

describe('acp estimate boundary', () => {
  it('returns the estimator’s own refusal as its sentence', async () => {
    setUiText(EN, BASE_LOCALE)
    const refusal = await catalogOptionsRefusal()
    const port = agent({ estimate: () => Promise.reject(refusal) })
    await expect(port.run('/estimate M117', '/tmp', new AbortController().signal)).resolves.toBe(
      fill(UI_TEXT.estimateFailed, { detail: 'catalog-options' }),
    )
  })

  it('keeps a foreign failure’s kind past the boundary', async () => {
    setUiText(EN, BASE_LOCALE)
    const foreign = estimateContractFailure()
    const port = agent({ estimate: () => Promise.reject(foreign) })
    let failure: unknown
    try {
      await port.run('/estimate M117', '/tmp', new AbortController().signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBe(foreign)
  })

  it('keeps cancellation as cancellation', async () => {
    setUiText(EN, BASE_LOCALE)
    const port = agent({
      estimate: () => Promise.reject(new Error('never runs while aborted')),
    })
    const controller = new AbortController()
    controller.abort()
    let failure: unknown
    try {
      await port.run('/estimate M117', '/tmp', controller.signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure instanceof DOMException && failure.name).toBe('AbortError')
  })
})
