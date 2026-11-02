// D261 (lane RLF-FALLBACK): the model a refused turn continues on. The
// real decision runs here on real inputs: a `refusal` stop with a named,
// different model switches; anything else leaves the refusal standing.
import { describe, expect, it } from 'vitest'
import {
  refusalFallbackTarget,
  type RefusalFallbackAsk,
} from '../../src/core/backends/modelapi/refusalFallback'

const refused: RefusalFallbackAsk = {
  incompleteReason: 'refusal',
  fallbackModel: 'meta/zenith-1.0',
  refusedModel: 'meta/sonnet-5.5',
  didFallback: false,
}

describe('refusal fallback target (D261)', () => {
  it('continues a refused turn on the named model', () => {
    expect(refusalFallbackTarget(refused)).toBe('meta/zenith-1.0')
  })

  it('trims the named model', () => {
    expect(
      refusalFallbackTarget({
        incompleteReason: 'refusal',
        fallbackModel: '  meta/zenith-1.0  ',
        refusedModel: 'meta/sonnet-5.5',
        didFallback: false,
      }),
    ).toBe('meta/zenith-1.0')
  })

  it.each([
    ['no incomplete reason', undefined],
    ['an output-limit stop', 'max_output_tokens'],
    ['a paused turn', 'pause_turn'],
    ['a content filter', 'content_filter'],
    ['a length stop', 'length'],
  ])('leaves a %s standing', (_label, incompleteReason) => {
    expect(
      refusalFallbackTarget({
        incompleteReason,
        fallbackModel: 'meta/zenith-1.0',
        refusedModel: 'meta/sonnet-5.5',
        didFallback: false,
      }),
    ).toBeUndefined()
  })

  it.each([['empty'], ['blank']])(
    'leaves a refusal standing when nothing is named (%s)',
    (kind) => {
      expect(
        refusalFallbackTarget({
          incompleteReason: 'refusal',
          fallbackModel: kind === 'empty' ? '' : ' '.repeat(3),
          refusedModel: 'meta/sonnet-5.5',
          didFallback: false,
        }),
      ).toBeUndefined()
    },
  )

  it('leaves a refusal standing when the named model is already running', () => {
    expect(
      refusalFallbackTarget({
        incompleteReason: 'refusal',
        fallbackModel: 'meta/sonnet-5.5',
        refusedModel: 'meta/sonnet-5.5',
        didFallback: false,
      }),
    ).toBeUndefined()
  })

  it('falls back once per turn: a second refusal stands', () => {
    expect(
      refusalFallbackTarget({
        incompleteReason: 'refusal',
        fallbackModel: 'meta/zenith-1.0',
        refusedModel: 'meta/sonnet-5.5',
        didFallback: true,
      }),
    ).toBeUndefined()
  })
})
