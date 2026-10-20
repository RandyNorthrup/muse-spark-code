// The estimate composer binding: the estimator's own command text is
// submitted through the port; anything else is left for the composer.
import { describe, expect, it } from 'vitest'
import { wasEstimateComposerHandled } from '../../src/webview/estimator/composer'

describe('estimate composer binding', () => {
  it('submits the estimator command text through the port', () => {
    const submitted: string[] = []
    const wasHandled = wasEstimateComposerHandled('/estimate M117', {
      submit: (text: string) => {
        submitted.push(text)
      },
    })
    expect(wasHandled).toBe(true)
    expect(submitted).toEqual(['/estimate M117'])
  })

  it('leaves anything else for the composer', () => {
    const submitted: string[] = []
    const wasHandled = wasEstimateComposerHandled('hello', {
      submit: (text: string) => {
        submitted.push(text)
      },
    })
    expect(wasHandled).toBe(false)
    expect(submitted).toEqual([])
  })
})
