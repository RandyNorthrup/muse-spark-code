// The estimate composer binding (D119): the estimator's own refusal keeps
// its detail in the notice; anything else reads failed and keeps its kind
// past the composer for the host log.
import { describe, expect, it } from 'vitest'
import { lookupEstimatePrices } from '../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../src/host/estimator/localFleet'
import { estimateSectionSchema } from '../../src/shared/estimate'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { wasEstimateComposerHandled } from '../../src/webview/estimator/composer'

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

describe('estimate composer binding', () => {
  it('notices the estimator’s own refusal in its own words', async () => {
    setUiText(EN, BASE_LOCALE)
    const refusal = await catalogOptionsRefusal()
    const notices: string[] = []
    const wasHandled = wasEstimateComposerHandled('/estimate M117', {
      context: () => ({ asOf: AS_OF, optimize: 'cost' }),
      open: () => {
        throw refusal
      },
      notice: (text) => {
        notices.push(text)
      },
    })
    expect(wasHandled).toBe(true)
    expect(notices).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'catalog-options' })])
  })

  it('notices failed while the foreign failure keeps its kind past the composer', () => {
    setUiText(EN, BASE_LOCALE)
    const foreign = contractFailure()
    const notices: string[] = []
    let failure: unknown
    try {
      wasEstimateComposerHandled('/estimate M117', {
        context: () => ({ asOf: AS_OF, optimize: 'cost' }),
        open: () => {
          throw foreign
        },
        notice: (text) => {
          notices.push(text)
        },
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(notices).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'estimator-unavailable' })])
    expect(failure).toBe(foreign)
  })
})
