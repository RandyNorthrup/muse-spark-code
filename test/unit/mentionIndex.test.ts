import { describe, expect, it, vi } from 'vitest'
import { buildMentionItems, MentionIndex } from '../../src/core/mentionIndex'
import { FakeLogOutputChannel } from './helpers/fakes'

function setup(files: readonly string[], options: { limit?: number } = {}) {
  let now = 1000
  const listFiles = vi.fn(() => Promise.resolve(files))
  const log = new FakeLogOutputChannel()
  const index = new MentionIndex({
    listFiles,
    now: () => now,
    ttlMs: 100,
    limit: options.limit ?? 1000,
    log,
  })
  return {
    index,
    listFiles,
    log,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('buildMentionItems', () => {
  it('adds every ancestor folder once, before the files', () => {
    expect(buildMentionItems(['src/a/b.ts', 'src/c.ts', 'README.md'])).toEqual([
      { path: 'src/', isFolder: true },
      { path: 'src/a/', isFolder: true },
      { path: 'src/a/b.ts', isFolder: false },
      { path: 'src/c.ts', isFolder: false },
      { path: 'README.md', isFolder: false },
    ])
  })
})

describe('MentionIndex', () => {
  it('ranks files and folders for a query and caps the result', async () => {
    const { index } = setup(['src/webview/App.tsx', 'src/host/settings.ts', 'README.md'])
    await expect(index.search('app', 10)).resolves.toEqual([
      { path: 'src/webview/App.tsx', isFolder: false },
    ])
    await expect(index.search('src', 2)).resolves.toEqual([
      { path: 'src/', isFolder: true },
      { path: 'src/host/', isFolder: true },
    ])
  })

  it('lists files only once per TTL and again after it expires or is invalidated', async () => {
    const { index, listFiles, advance } = setup(['a.ts'])
    await index.search('', 10)
    await index.search('', 10)
    expect(listFiles).toHaveBeenCalledTimes(1)
    advance(101)
    await index.search('', 10)
    expect(listFiles).toHaveBeenCalledTimes(2)
    index.invalidate()
    await index.search('', 10)
    expect(listFiles).toHaveBeenCalledTimes(3)
  })

  it('shares one in-flight listing between concurrent searches', async () => {
    const { index, listFiles } = setup(['a.ts', 'b.ts'])
    const [first, second] = await Promise.all([index.search('a', 10), index.search('b', 10)])
    expect(first).toEqual([{ path: 'a.ts', isFolder: false }])
    expect(second).toEqual([{ path: 'b.ts', isFolder: false }])
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  it('truncates oversized listings and says so', async () => {
    const { index, log } = setup(['a.ts', 'b.ts', 'c.ts'], { limit: 2 })
    await expect(index.search('', 10)).resolves.toEqual([
      { path: 'a.ts', isFolder: false },
      { path: 'b.ts', isFolder: false },
    ])
    expect(log.warn).toHaveBeenCalledWith('Mention index truncated to 2 of 3 paths')
  })
})
