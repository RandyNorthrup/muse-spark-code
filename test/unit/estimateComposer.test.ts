// The estimate composer binding (D119): the estimator's own refusal keeps
// its detail in the notice; anything else reads failed and keeps its kind
// past the composer for the host log.
import { describe, expect, it } from 'vitest'
import {
  catalogOptionsRefusal,
  ESTIMATE_AS_OF,
  estimateContractFailure,
} from './helpers/estimateFailures'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { wasEstimateComposerHandled } from '../../src/webview/estimator/composer'

describe('estimate composer binding', () => {
  it('notices the estimator’s own refusal in its own words', async () => {
    setUiText(EN, BASE_LOCALE)
    const refusal = await catalogOptionsRefusal()
    const notices: string[] = []
    const wasHandled = wasEstimateComposerHandled('/estimate M117', {
      context: () => ({ asOf: ESTIMATE_AS_OF, optimize: 'cost' }),
      open: () => {
        throw refusal
      },
      notice: (text: string) => {
        notices.push(text)
      },
    })
    expect(wasHandled).toBe(true)
    expect(notices).toEqual([fill(UI_TEXT.estimateFailed, { detail: 'catalog-options' })])
  })

  it('notices failed while the foreign failure keeps its kind past the composer', () => {
    setUiText(EN, BASE_LOCALE)
    const foreign = estimateContractFailure()
    const notices: string[] = []
    let failure: unknown
    try {
      wasEstimateComposerHandled('/estimate M117', {
        context: () => ({ asOf: ESTIMATE_AS_OF, optimize: 'cost' }),
        open: () => {
          throw foreign
        },
        notice: (text: string) => {
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
