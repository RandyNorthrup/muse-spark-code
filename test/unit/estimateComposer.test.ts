// The estimate composer binding: the eager half of `/estimate` dispatch
// hands the draft to the lazy runtime; anything else keeps its normal
// dispatch.
import { describe, expect, it } from 'vitest'
import { wasEstimateComposerHandled } from '../../src/webview/estimator/composer'

describe('estimate composer binding', () => {
  it('submits estimate drafts to the lazy runtime', () => {
    const submitted: string[] = []
    const submit = (text: string): void => {
      submitted.push(text)
    }
    expect(wasEstimateComposerHandled('/estimate M117', { submit })).toBe(true)
    expect(wasEstimateComposerHandled('/estimate', { submit })).toBe(true)
    expect(submitted).toEqual(['/estimate M117', '/estimate'])
  })

  it('leaves other drafts to their normal dispatch', () => {
    let calls = 0
    const submit = (): void => {
      calls += 1
    }
    expect(wasEstimateComposerHandled('/estimateX', { submit })).toBe(false)
    expect(wasEstimateComposerHandled('/help', { submit })).toBe(false)
    expect(calls).toBe(0)
  })
})
