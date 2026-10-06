import { describe, expect, it, vi } from 'vitest'
import { PullRequestLinks, type PullRequestLink } from '../../src/host/git/pullRequestLinks'
import { memoryMemento } from './helpers/fakeGit'

const LINK: PullRequestLink = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 56,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
  title: 'README: how this extension is built',
  linkedAt: 1,
}

describe('conversation PR links (M71)', () => {
  it('preserves concurrent conversations while persistence is delayed', async () => {
    const memory = memoryMemento()
    const firstWrite = Promise.withResolvers<undefined>()
    const writes: unknown[] = []
    const links = new PullRequestLinks({
      get: memory.get,
      update: async (key, value) => {
        writes.push(value)
        if (writes.length === 1) {
          await firstWrite.promise
        }
        await memory.update(key, value)
      },
    })
    const first = links.set('first', LINK)
    const second = links.set('second', { ...LINK, linkedAt: 2 })
    await vi.waitFor(() => {
      expect(writes.length).toBeGreaterThan(0)
    })
    firstWrite.resolve(undefined)
    await Promise.all([first, second])
    expect(links.get('first')).toEqual(LINK)
    expect(links.get('second')).toEqual({ ...LINK, linkedAt: 2 })
  })

  it('never reads an inherited object member as a saved conversation link', () => {
    const links = new PullRequestLinks(memoryMemento())
    expect(links.get('constructor')).toBeUndefined()
    expect(links.get('__proto__')).toBeUndefined()
  })
})
