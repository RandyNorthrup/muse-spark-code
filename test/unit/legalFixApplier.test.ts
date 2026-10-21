// The legal-fix applier fails closed: an approval that cannot be read
// refuses every path, and a write that fails refuses its path — each
// with the fixed review-failed words, never the failure's own.

import { describe, expect, it } from 'vitest'
import { createLegalFixApplier } from '../../src/host/legalFixApplier'
import { UI_TEXT } from '../../src/shared/constants'

const patch = { path: 'a.txt', diff: '--- a\n+++ b\n' }
const entry = { patch, evidence: [], before: '', after: 'x' }

function applier(overrides: {
  approveOwnership?: () => Promise<boolean>
  write?: () => Promise<boolean>
}) {
  return createLegalFixApplier({
    prepare: () => Promise.resolve([entry]),
    readHash: () => Promise.resolve('hash'),
    approveOwnership: overrides.approveOwnership ?? (() => Promise.resolve(true)),
    write: overrides.write ?? (() => Promise.resolve(true)),
  })
}

describe('apply', () => {
  it('refuses every path when the approval cannot be read', async () => {
    const result = await applier({
      approveOwnership: () => Promise.reject(new Error('ownership store gone')),
    }).apply([], ['a.txt'], [patch], () => true)
    expect(result.applied).toEqual([])
    expect(result.failed).toEqual([{ path: 'a.txt', reason: UI_TEXT.editReviewFailed }])
  })

  it('refuses a path whose write fails while keeping the others', async () => {
    const second = { path: 'b.txt', diff: '--- b\n+++ c\n' }
    const both = createLegalFixApplier({
      prepare: () => Promise.resolve([entry, { ...entry, patch: second }]),
      readHash: () => Promise.resolve('hash'),
      approveOwnership: () => Promise.resolve(true),
      write: (path) =>
        path === 'a.txt' ? Promise.reject(new Error('disk gone')) : Promise.resolve(true),
    })
    await both.prepare?.([], ['a.txt', 'b.txt'])
    const result = await both.apply([], ['a.txt', 'b.txt'], [patch, second], () => true)
    expect(result.applied).toEqual(['b.txt'])
    expect(result.failed).toEqual([{ path: 'a.txt', reason: UI_TEXT.editReviewFailed }])
  })
})
