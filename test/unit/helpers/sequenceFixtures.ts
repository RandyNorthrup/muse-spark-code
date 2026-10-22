// One stored sequence for the store and panel suites; overrides win.
import type { SavedSequence } from '../../../src/shared/sequences'

export function sequence(overrides: Partial<SavedSequence> = {}): SavedSequence {
  return {
    schemaVersion: 1,
    id: 'seq-1',
    name: 'Morning review',
    steps: ['First', 'Second'],
    scope: 'user',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  }
}
