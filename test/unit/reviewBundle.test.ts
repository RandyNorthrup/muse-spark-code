// The review's own bundle (M70, PLAN.md D6): src/host/review/reviewEntry.ts
// built with esbuild into a temporary folder, in the production build's
// format, platform and target, then required by
// `lazyReview` with Node's own `require`, as activate requires dist/review.js.
// A review that cannot load is never skipped: it says so, until one loads.

import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { reviewTurnText } from '../../src/core/review/reviewPrompt'
import { requireFile } from '../../src/host/lazyBundle'
import { createLogger } from '../../src/host/logger'
import { isReviewBundle, lazyReview } from '../../src/host/review/reviewBundle'
import { REVIEW_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }
const REQUEST = { scope: 'custom', focus: 'general', instructions: 'the cache' } as const

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-review-bundle-'))
  built.file = path.join(built.folder, REVIEW_BUNDLE_FILE)
  await build({
    entryPoints: [path.resolve('src/host/review/reviewEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    logLevel: 'silent',
  })
})

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

afterAll(() => removeFolder(built.folder))

function deps(overrides: Partial<Parameters<typeof lazyReview>[0]> = {}) {
  return {
    bundlePath: built.file,
    log: createLogger(new FakeLogOutputChannel()),
    workspaceRoot: '/ws',
    runGit: () => Promise.reject(new Error('git must not run here')),
    pickOne: () => Promise.resolve(undefined),
    editReview: {
      platform: process.platform,
      workspaceRoot: '/ws',
      readFile: () => Promise.resolve(undefined),
      realPath: (file: string) => Promise.resolve(file),
      hasUnsavedChanges: () => false,
      writeFile: () => Promise.resolve(),
      deleteFile: () => Promise.resolve(),
      openDiff: () => Promise.resolve(),
      log: createLogger(new FakeLogOutputChannel()),
    },
    ...overrides,
  }
}

describe('the review bundle (M70)', () => {
  it('loads on first use, once, and builds the turn text the activation bundle would', () => {
    const load = vi.fn(requireFile)
    const review = lazyReview(deps({ loadBundle: load }))
    expect(load).not.toHaveBeenCalled()
    const input = {
      request: REQUEST,
      material: undefined,
      isRoleIncluded: true,
      newMarker: () => 'm',
    }
    expect(review.turnText(input)).toBe(reviewTurnText(input))
    expect(review.newMarker()).toMatch(/^[0-9a-f]{16}$/)
    expect(load).toHaveBeenCalledOnce()
  })

  it('reads the table the activation bundle installed, before it reads a string', async () => {
    setUiText({ ...EN, reviewCancelled: 'localized cancelled' }, 'de')
    const review = lazyReview(deps())
    const hold = review.createHold({
      planMode: 'denyUnmatched',
      restoreMode: () => 'promptUnmatched',
      onRestored: () => undefined,
    })
    hold.release()
    const session = {
      setApprovalMode: () => Promise.resolve(),
      sendTurn: () => Promise.reject(new Error('the send must not happen')),
    }
    await expect(hold.send(session, [], 'review', () => true)).rejects.toThrow(
      'localized cancelled',
    )
  })

  it('says there is no repository without a folder, and loads nothing for it', async () => {
    const load = vi.fn(requireFile)
    const review = lazyReview(deps({ workspaceRoot: undefined, loadBundle: load }))
    await expect(
      review.collect({ scope: 'uncommitted', focus: 'general' }, () => true),
    ).resolves.toEqual({ kind: 'refused', refusal: 'notRepository' })
    expect(load).not.toHaveBeenCalled()
  })

  it('serves no edit document before anything opened the bundle', () => {
    const load = vi.fn(requireFile)
    const review = lazyReview(deps({ loadBundle: load }))
    expect(review.editReview.provide('/item/a.ts')).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })

  it('reads the edit review through the bundle’s own copy', async () => {
    const review = lazyReview(deps())
    await expect(review.editReview.describe('not a patch document')).rejects.toThrow(
      UI_TEXT.editNoPatch,
    )
  })

  it('refuses with the reason, and logs the cause, when the bundle is missing or is not the review', () => {
    const channel = new FakeLogOutputChannel()
    const log = createLogger(channel)
    const missing = lazyReview(deps({ bundlePath: path.join(built.folder, 'missing.js'), log }))
    expect(() => missing.newMarker()).toThrow(UI_TEXT.reviewUnavailable)
    expect(() => missing.newMarker()).toThrow(UI_TEXT.reviewUnavailable)
    const wrong = path.join(built.folder, 'wrong.js')
    writeFileSync(wrong, 'module.exports = { createReviewFeatures: 1 }')
    const repaired = lazyReview(deps({ bundlePath: wrong, log }))
    expect(() => repaired.newMarker()).toThrow(UI_TEXT.reviewUnavailable)
    copyFileSync(built.file, wrong)
    expect(repaired.newMarker()).toMatch(/^[0-9a-f]{16}$/)
    expect(logLines(channel).join('\n')).toContain('does not export the review')
  })

  it('requires the bundle’s factory to be a function', () => {
    expect(isReviewBundle(undefined)).toBe(false)
    expect(isReviewBundle(null)).toBe(false)
    expect(isReviewBundle({ createReviewFeatures: true })).toBe(false)
    expect(isReviewBundle({ createReviewFeatures: () => undefined })).toBe(true)
  })
})
