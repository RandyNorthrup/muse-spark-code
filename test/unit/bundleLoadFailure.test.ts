// Missing bundles over the real loader: a bundle that is not there
// throws the bundle's own unavailable words, keeps the real failure as
// its cause, and is tried again on the next call instead of caching.

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lazyBundleLoader } from '../../src/host/lazyBundle'
import type { Logger } from '../../src/host/logger'
import { planMarkdownLoader } from '../../src/host/planMarkdownBundle'
import { UI_TEXT } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-bundle-load-')))
afterAll(async () => {
  await removeFolder(base)
})

function logger(messages: string[]): Logger {
  const push = (message: string) => {
    messages.push(message)
  }
  return { info: push, warn: push, error: push, debug: push, trace: push }
}

describe('lazyBundleLoader', () => {
  it('throws the unavailable words with the load failure as the cause', () => {
    const messages: string[] = []
    const load = lazyBundleLoader<{ marker: number }>({
      bundlePath: path.join(base, 'dist', 'missing.js'),
      log: logger(messages),
      isBundle: (value): value is { marker: number } =>
        typeof value === 'object' && value !== null && 'marker' in value,
      label: 'test bundle',
      unavailable: () => 'test bundle unavailable',
    })
    let first: unknown
    try {
      load()
    } catch (error: unknown) {
      first = error
    }
    expect(first instanceof Error ? first.message : undefined).toBe('test bundle unavailable')
    expect(first instanceof Error ? first.cause : undefined).toBeInstanceOf(Error)
    expect(messages).toHaveLength(1)
    let second: unknown
    try {
      load()
    } catch (error: unknown) {
      second = error
    }
    expect(second instanceof Error ? second.message : undefined).toBe('test bundle unavailable')
    expect(messages).toHaveLength(2)
  })
})

describe('planMarkdownLoader', () => {
  it('throws the plan words with the load failure as the cause', () => {
    const messages: string[] = []
    const load = planMarkdownLoader({
      bundlePath: path.join(base, 'dist', 'planMarkdown.js'),
      log: logger(messages),
    })
    let failure: unknown
    try {
      load()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure instanceof Error ? failure.message : undefined).toBe(
      UI_TEXT.planMarkdownUnavailable,
    )
    expect(failure instanceof Error ? failure.cause : undefined).toBeInstanceOf(Error)
    expect(messages).toHaveLength(1)
  })
})
