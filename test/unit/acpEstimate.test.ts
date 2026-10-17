// The ACP estimate boundary (D119): the estimator's own refusal stays its
// sentence for the agent, anything else keeps its kind past the boundary,
// and cancellation stays cancellation.
import { describe, expect, it } from 'vitest'
import { lookupEstimatePrices } from '../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../src/host/estimator/localFleet'
import { estimateSectionSchema } from '../../src/shared/estimate'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { createAcpEstimate } from '../../src/acp/estimate'
import type { EstimateRunPort } from '../../src/runtime/estimator/command'

const AS_OF = '2026-10-17T00:00:00.000Z'

function pricePorts() {
  return estimatorSourcePorts(() => ({
    enabled: true,
    networkAllowed: false,
    maxAgeMs: 60_000,
    catalogUrls: [],
  })).prices()
}

async function catalogOptionsRefusal(): Promise<Error> {
  try {
    await lookupEstimatePrices(
      {
        asOf: AS_OF,
        enabled: true,
        networkAllowed: false,
        maxAgeMs: 60_000,
        catalogUrls: ['https://example.com/a.json', 'https://example.com/a.json'],
      },
      pricePorts(),
    )
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('lookup did not refuse duplicate catalogs')
}

function contractFailure(): Error {
  try {
    estimateSectionSchema.parse({})
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('section schema accepted an empty object')
}

function agent(runner: EstimateRunPort) {
  return createAcpEstimate({
    context: () => ({ asOf: AS_OF, optimize: 'cost' }),
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
    const foreign = contractFailure()
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
