// "Open a Pull Request in a Conversation…"
// (src/host/git/conversationGitBundle.ts): the command runs the factory
// chain the extension runs (extension.ts: a bundle loader over Node's own
// require, memoized by gitFeaturesLoader). A bundle that cannot load shows
// the fixed unavailable words; a bundle that loads but fails while making
// its features is never shown as-is and reaches the caller instead; a
// bundle that loads opens through its features, loading once. The bundles
// are real files through the product's own require; the window's own git
// primitives need VS Code, so no harness builds them headless.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  conversationGitLoader,
  gitFeaturesLoader,
  openPullRequestInConversation,
} from '../../src/host/git/conversationGitBundle'
import type { GitFeaturesDeps } from '../../src/host/git/gitWindow'
import { requireFile } from '../../src/host/lazyBundle'
import type { Logger } from '../../src/host/logger'
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
  const bundle = conversationGitLoader({ bundlePath, log })
  return {
    errors,
    features: gitFeaturesLoader(
      bundle,
      // The window's git primitives need VS Code, so no harness builds
      // them headless (as the review bundle's refused load keeps the same
      // slot empty): the refused load never reaches them, and the fixture
      // bundles below ignore the arguments they are called with.
      {} as unknown as GitFeaturesDeps,
    ),
  }
}

describe('openPullRequestInConversation', () => {
  it('shows the fixed words when the bundle cannot load', async () => {
    await usingTempDir('conversation-git-', async (root) => {
      const { errors, features } = harness(path.join(root, 'missing-bundle.cjs'))
      const shown: string[] = []
      await openPullRequestInConversation(features, (message) => {
        shown.push(message)
      })
      expect(shown).toEqual([UI_TEXT.gitUnavailable])
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('conversation Git bundle')
    })
  })

  it('rethrows a foreign load failure instead of showing it', async () => {
    await usingTempDir('conversation-git-', async (root) => {
      const bundlePath = path.join(root, 'foreign-bundle.cjs')
      writeFileSync(
        bundlePath,
        [
          'const foreign = new Error("the conversation bundle failed while making features");',
          'module.exports = {',
          '  createConversationGit: () => { throw new Error("not under test"); },',
          '  createGitFeatures: () => { throw foreign; },',
          '  foreign,',
          '};',
          '',
        ].join('\n'),
        'utf8',
      )
      const { errors, features } = harness(bundlePath)
      const shown: string[] = []
      let failure: unknown
      try {
        await openPullRequestInConversation(features, (message) => {
          shown.push(message)
        })
      } catch (error: unknown) {
        failure = error
      }
      // The identical error the fixture threw: it reaches the caller
      // unwrapped, never shown as-is.
      const loaded: unknown = requireFile(bundlePath)
      if (typeof loaded !== 'object' || loaded === null || !('foreign' in loaded)) {
        throw new Error('the fixture must export the error it throws')
      }
      expect(failure).toBe(loaded.foreign)
      expect(shown).toEqual([])
      expect(errors).toEqual([])
    })
  })

  it('opens through the loaded features, loading the bundle once', async () => {
    await usingTempDir('conversation-git-', async (root) => {
      const bundlePath = path.join(root, 'recording-bundle.cjs')
      writeFileSync(
        bundlePath,
        [
          'const fs = require("node:fs");',
          'const path = require("node:path");',
          'const marker = path.join(__dirname, "opened.marker");',
          'module.exports = {',
          '  createConversationGit: () => { throw new Error("not under test"); },',
          '  createGitFeatures: () => ({',
          '    window: {},',
          '    openPullRequestInConversation: async () => {',
          String.raw`      fs.appendFileSync(marker, "opened\n");`,
          '    },',
          '  }),',
          '};',
          '',
        ].join('\n'),
        'utf8',
      )
      const { errors, features } = harness(bundlePath)
      // The loader memoizes the bundle it required: the same features.
      expect(features()).toBe(features())
      const shown: string[] = []
      await openPullRequestInConversation(features, (message) => {
        shown.push(message)
      })
      expect(readFileSync(path.join(root, 'opened.marker'), 'utf8')).toBe('opened\n')
      expect(shown).toEqual([])
      expect(errors).toEqual([])
    })
  })
})
