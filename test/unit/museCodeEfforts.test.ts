// Lane REASONSHAPES (META-G05): Muse Code's per-model effort metadata is
// pure data in, pure data out. The row shape is UNVERIFIED until a 1.4.x
// live capture lands (capture plan META-LIST); these tests pin the
// conservative reading, not the wire.
import { describe, expect, it } from 'vitest'
import {
  museCodeEffortPort,
  museModelEffortTiers,
  parseMuseCodeEffortInfo,
} from '../../src/core/backends/musecode/MuseCodeHost'

describe('Muse Code per-model effort metadata', () => {
  it('reads the tiers, the described subset and the default off a row', () => {
    expect(
      parseMuseCodeEffortInfo({
        modelId: 'muse-wonder-1.0',
        displayLabel: 'Wonder',
        contextLimit: 1_000_000,
        isDefault: false,
        variants: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        reasoningEffortVariants: [
          { tier: 'max', description: 'Deepest reasoning' },
          { tier: 'high', description: 'Deep reasoning' },
        ],
        defaultReasoningEffort: 'high',
      }),
    ).toEqual({
      variants: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      reasoningEffortVariants: [
        { tier: 'max', description: 'Deepest reasoning' },
        { tier: 'high', description: 'Deep reasoning' },
      ],
      defaultReasoningEffort: 'high',
    })
  })

  it('keeps unknown rows absent, never guessed', () => {
    expect(parseMuseCodeEffortInfo({})).toEqual({})
    expect(parseMuseCodeEffortInfo(null)).toEqual({})
    expect(parseMuseCodeEffortInfo('muse-spark-1.3')).toEqual({})
    expect(parseMuseCodeEffortInfo({ variants: 'unknown' })).toEqual({ variants: 'unknown' })
    expect(parseMuseCodeEffortInfo({ variants: [1, 2] })).toEqual({})
  })

  it('offers only UI tiers, deduplicated and in row order', () => {
    expect(
      museModelEffortTiers({
        variants: ['high', 'turbo', 'high', 'ultra'],
        defaultReasoningEffort: 'high',
      }),
    ).toEqual({ levels: ['high', 'ultra'], defaultEffort: 'high' })
    expect(museModelEffortTiers({})).toEqual({ levels: [], defaultEffort: undefined })
    expect(
      museModelEffortTiers({
        reasoningEffortVariants: [{ tier: 'max' }, { tier: 'low' }],
        defaultReasoningEffort: 'warp',
      }),
    ).toEqual({ levels: ['max', 'low'], defaultEffort: undefined })
  })

  it('supplies the reader as the default effort port', () => {
    expect(museCodeEffortPort.modelEfforts.parseModel({ variants: ['high'] })).toEqual({
      variants: ['high'],
    })
  })
})
