// The review bundle's load refusal (src/host/review/reviewBundle.ts): a
// bundle that cannot load is refused with the fixed unavailable words and
// the failure as its cause; the log names only the failure's kind, never
// its message or the bundle's path.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { Logger } from '../../src/host/logger'
import { lazyReview, type LazyReviewDeps } from '../../src/host/review/reviewBundle'

function harness(loadBundle: (file: string) => unknown) {
  const errors: string[] = []
  const log: Logger = {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message) => {
      errors.push(message)
    },
  }
  const deps: LazyReviewDeps = {
    bundlePath: '/secret/path/review.js',
    log,
    workspaceRoot: '/ws',
    runGit: () => Promise.reject(new Error('never called')),
    pickOne: () => Promise.resolve(undefined),
    // The refused load never reaches edit review: no harness fills it.
    editReview: {} as unknown as LazyReviewDeps['editReview'],
    loadBundle,
  }
  return { deps, errors }
}

describe('lazyReview', () => {
  it('refuses an unloadable bundle with fixed words and the cause', async () => {
    const loadError = new Error("Cannot find module '/secret/path/review.js'")
    const { deps, errors } = harness(() => {
      throw loadError
    })
    let failure: unknown
    try {
      await lazyReview(deps).collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.reviewUnavailable)
    expect((failure as Error).cause).toBe(loadError)
    expect(errors).toEqual(['The review bundle could not be loaded: Error'])
    for (const logged of errors) {
      expect(logged).not.toContain('/secret/path')
      expect(logged).not.toContain('Cannot find module')
    }
  })

  it('refuses a bundle with the wrong shape without its path', async () => {
    const { deps, errors } = harness(() => ({}))
    let failure: unknown
    try {
      await lazyReview(deps).collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.reviewUnavailable)
    expect(errors).toEqual(['The review bundle does not export the review'])
  })
})
