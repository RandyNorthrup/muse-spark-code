// Capability admission has one source (RVCM1063D cause 1): what a model may
// be asked for comes from the served variants through `servedEffortLevels`.
// No caller reads the static family table itself.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EFFORT_LEVELS } from '../../src/shared/constants'
import { servedEffortLevels } from '../../src/shared/effort'

const STATIC_LIST = 'MODEL_EFFORT_LEVELS'
function compareNames(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function sourceFiles(root: string): string[] {
  const entries = readdirSync(root, { recursive: true }) as string[]
  return entries
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => path.join(root, name).replaceAll('\\', '/'))
}

function staticListLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes(STATIC_LIST))
}

describe('effort admission has one source', () => {
  it('lets only the shared function read the static family table', () => {
    const readers = sourceFiles('src').filter((file) =>
      readFileSync(file, 'utf8').includes(STATIC_LIST),
    )
    // The definition, the one function, and the help-reference barrel that
    // re-exports it for the generated reference: no admission caller.
    expect(readers.toSorted(compareNames)).toEqual(
      [
        'src/shared/constants.ts',
        'src/shared/effort.ts',
        'src/shared/reference/referenceSource.ts',
      ].toSorted(compareNames),
    )
    // Only the shared function indexes the table; the barrel only names it
    // in its re-export.
    expect(
      staticListLines('src/shared/effort.ts').some((line) => line.includes(`${STATIC_LIST}[`)),
    ).toBe(true)
    for (const line of staticListLines('src/shared/reference/referenceSource.ts')) {
      expect(line).not.toMatch(/MODEL_EFFORT_LEVELS\s*[[(.]/)
    }
  })

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
