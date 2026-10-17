// The estimate view session (D119): only the current run reports; the
// estimator's own refusal keeps its detail in words, anything else reads
// failed without its raw text, and a superseded failure stays silent.
import { describe, expect, it } from 'vitest'
import { lookupEstimatePrices } from '../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../src/host/estimator/localFleet'
import { estimateSectionSchema } from '../../src/shared/estimate'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import type { EstimateRunPort } from '../../src/runtime/estimator/command'
import { EstimateViewSession } from '../../src/runtime/estimator/session'

const AS_OF_1 = '2026-10-17T00:00:01.000Z'
const AS_OF_2 = '2026-10-17T00:00:02.000Z'

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
        asOf: AS_OF_1,
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

function makeSession(runner: EstimateRunPort): {
  session: EstimateViewSession
  texts: string[]
} {
  const texts: string[] = []
  const sections: unknown[] = []
  const listeners: ((event: unknown) => void)[] = []
  const session = new EstimateViewSession(
    {
      goal: { kind: 'milestone', milestoneId: 'M117' },
      fleet: 'current',
      format: 'text',
    },
    { asOf: AS_OF_1, optimize: 'cost' },
    runner,
    {
      subscribe: (listener) => {
        listeners.push(listener)
        return () => {
          listeners.length = 0
        }
      },
    },
    (section) => {
      sections.push(section)
    },
    (text) => {
      texts.push(text)
    },
  )
  return { session, texts }
}

describe('estimate view session failures', () => {
  it('says the estimator’s own refusal in its own words', async () => {
    setUiText(EN, BASE_LOCALE)
    const refusal = await catalogOptionsRefusal()
    const { session, texts } = makeSession({ estimate: () => Promise.reject(refusal) })
    await session.refresh()
    expect(texts).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'catalog-options' })])
  })

  it('reads a foreign failure as failed, without its raw text', async () => {
    setUiText(EN, BASE_LOCALE)
    const { session, texts } = makeSession({ estimate: () => Promise.reject(contractFailure()) })
    await session.refresh()
    expect(texts).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' })])
  })

  it('keeps a superseded failure silent while the current run reports', async () => {
    setUiText(EN, BASE_LOCALE)
    const refusal = await catalogOptionsRefusal()
    const foreign = contractFailure()
    let calls = 0
    const { session, texts } = makeSession({
      estimate: () => {
        calls += 1
        if (calls === 1)
          return new Promise((_, reject) => {
            setTimeout(() => {
              reject(refusal)
            }, 50)
          })
        return Promise.reject(foreign)
      },
    })
    const first = session.refresh(AS_OF_1)
    await session.refresh(AS_OF_2)
    // Settled, never an unsettled rejection: the view reports through its
    // error port.
    await first
    expect(texts).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' })])
  })
})
