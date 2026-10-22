// M88 lane P: the prompt sequence contracts. A sequence round-trips
// through its file bytes; a foreign file never yields an empty sequence;
// the scopes merge user-first in library order with per-scope ids kept.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import {
  mergeSequenceScopes,
  parseSequenceFile,
  savedSequenceSchema,
  sequenceRunViewSchema,
  serialiseSequenceFile,
  type SavedSequence,
} from '../../src/shared/sequences'

function sequence(overrides: Partial<SavedSequence> = {}): SavedSequence {
  return {
    schemaVersion: 1,
    id: 'seq-1',
    name: 'Morning review',
    steps: ['Summarise the overnight failures.', 'File the follow-ups.'],
    scope: 'user',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  }
}

describe('prompt sequence files', () => {
  it('round-trips a sequence through its file bytes', () => {
    const file = serialiseSequenceFile(sequence())
    expect(parseSequenceFile(file)).toEqual(sequence())
  })

  it('refuses a foreign file and a newer schema instead of an empty sequence', () => {
    expect(() => parseSequenceFile('not json')).toThrow(UI_TEXT.promptStoreDamaged)
    expect(() => parseSequenceFile(JSON.stringify({ ...sequence(), schemaVersion: 2 }))).toThrow()
    expect(() => parseSequenceFile(JSON.stringify(sequence({ id: '' })))).toThrow()
    expect(() => parseSequenceFile(JSON.stringify(sequence({ name: '' })))).toThrow()
  })

  it('merges user before workspace in name order, keeping same-name rows in both', () => {
    const merged = mergeSequenceScopes(
      [sequence({ id: 'b', name: 'Beta' }), sequence({ id: 'a', name: 'Alpha' })],
      [
        sequence({ id: 'a', name: 'Alpha', scope: 'workspace' }),
        sequence({ id: 'w', name: 'Workspace only', scope: 'workspace' }),
      ],
    )
    expect(merged.map((row) => `${row.scope}:${row.name}`)).toEqual([
      'user:Alpha',
      'user:Beta',
      'workspace:Alpha',
      'workspace:Workspace only',
    ])
  })

  it('reads the run the panel shows, and refuses a run past its end', () => {
    expect(
      sequenceRunViewSchema.parse({
        sequenceId: 'seq-1',
        scope: 'user',
        name: 'Morning review',
        step: 2,
        total: 4,
      }),
    ).toMatchObject({ step: 2, total: 4 })
    expect(() =>
      sequenceRunViewSchema.parse({
        sequenceId: 'seq-1',
        scope: 'user',
        name: 'Morning review',
        step: 0,
        total: 4,
      }),
    ).toThrow()
  })

  it('keeps the saved schema strict against unknown fields', () => {
    expect(() => savedSequenceSchema.parse({ ...sequence(), steps: 'not an array' })).toThrow()
  })
})
