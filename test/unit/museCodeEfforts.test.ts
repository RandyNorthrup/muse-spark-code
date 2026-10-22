// Lane REASONSHAPES (META-G05): Muse Code's per-model effort metadata is
// pure data in, pure data out. The row shape was UNVERIFIED until the
// 1.4.10 live capture landed (capture plan META-LIST,
// test/fixtures/muse-contributor/model-list-1.4.10.json); the last case
// pins the recorded rows, not the conservative reading.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultEffortFor } from '../../src/acp/agent'
import {
  modelListResultSchema,
  museCodeEffortPort,
  museModelEffortTiers,
  parseMuseCodeEffortInfo,
  toModelSummary,
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

  it('a new session starts on the recorded row default: max for 1.3, high for 1.2 (RLTESTDRIVE item 8)', () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL('../fixtures/muse-contributor/model-list-1.4.10.json', import.meta.url),
        'utf8',
      ),
    )
    const rows = modelListResultSchema.parse(raw).models
    const models = rows.map((row) => toModelSummary(row, museCodeEffortPort.modelEfforts))
    expect(models.find((model) => model.modelId === 'muse-spark-1.3')?.defaultEffort).toBe('max')
    expect(models.find((model) => model.modelId === 'muse-spark-1.2')?.defaultEffort).toBe('high')
    expect(defaultEffortFor(models, 'muse-spark-1.3')).toBe('max')
    expect(defaultEffortFor(models, 'muse-spark-1.2')).toBe('high')
    expect(defaultEffortFor(models, 'muse-spark-unknown')).toBe('high')
  })
})
