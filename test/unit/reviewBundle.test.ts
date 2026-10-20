// The review bundle's load refusal (src/host/review/reviewBundle.ts): a
// bundle that cannot load is refused with the fixed unavailable words and
// the failure as its cause; the log names only the failure's kind, never
// its message or the bundle's path. The bundle loads through the product's
// own Node require: a missing file fails with the real MODULE_NOT_FOUND,
// and a real file with the wrong shape fails the bundle check.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { Logger } from '../../src/host/logger'
import { lazyReview, type LazyReviewDeps } from '../../src/host/review/reviewBundle'
import { usingTempDir } from './helpers/temporaryFolders'

function harness(bundlePath: string) {
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
    bundlePath,
    log,
    workspaceRoot: '/ws',
    runGit: () => Promise.reject(new Error('never called')),
    pickOne: () => Promise.resolve(undefined),
    // The refused load never reaches edit review: no harness fills it.
    editReview: {} as unknown as LazyReviewDeps['editReview'],
  }
  return { deps, errors }
}

describe('lazyReview', () => {
  it('refuses an unloadable bundle with fixed words and the cause', async () => {
    const { deps, errors } = harness('/secret/path/review.js')
    let failure: unknown
    try {
      await lazyReview(deps).collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.reviewUnavailable)
    expect((failure as Error).cause).toBeInstanceOf(Error)
    expect(((failure as Error).cause as NodeJS.ErrnoException).code).toBe('MODULE_NOT_FOUND')
    expect(errors).toEqual(['The review bundle could not be loaded: Error'])
    for (const logged of errors) {
      expect(logged).not.toContain('/secret/path')
      expect(logged).not.toContain('Cannot find module')
    }
  })

  it('refuses a bundle with the wrong shape without its path', async () => {
    await usingTempDir('review-bundle-', async (root) => {
      const bundlePath = path.join(root, 'wrong-shape.cjs')
      writeFileSync(bundlePath, 'module.exports = {};\n')
      const { deps, errors } = harness(bundlePath)
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
})
