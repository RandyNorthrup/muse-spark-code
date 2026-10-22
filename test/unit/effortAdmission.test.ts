// Capability admission has one source (RVCM1063D cause 1): what a model may
// be asked for comes from the served variants through `servedEffortLevels`.
import { describe, expect, it } from 'vitest'
import { EFFORT_LEVELS } from '../../src/shared/constants'
import { servedEffortLevels } from '../../src/shared/effort'

describe('effort admission has one source', () => {
  it('serves the catalogue row for the model id', () => {
    const models = [
      { modelId: 'muse-spark-1.3', effortLevels: ['low', 'high'] as const, variants: ['low'] },
      { modelId: 'muse-spark-1.2', variants: ['low', 'high', 'turbo'] },
      { modelId: 'muse-spark-1.4', variants: 'unknown' as const },
    ]
    // The catalogue's variants win over a stale `effortLevels` list, and a
    // tier outside the vocabulary never becomes askable.
    expect(servedEffortLevels(models, 'muse-spark-1.3')).toEqual(['low'])
    expect(servedEffortLevels(models, 'muse-spark-1.2')).toEqual(['low', 'high'])
    expect(servedEffortLevels(models, 'muse-spark-1.4')).toEqual([])
    // No row: the static family table for a known prefix, the full UI range
    // otherwise, nothing for a provider-prefixed third-party id.
    expect(servedEffortLevels([], 'muse-spark-1.2')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(servedEffortLevels(undefined, 'muse-spark-9.9')).toEqual([...EFFORT_LEVELS])
    expect(servedEffortLevels(undefined, 'openai/gpt-5')).toEqual([])
  })
})
