// The runtime's pull request link store (M123 lane P): schema, the
// newest-200 bound and the in-memory port, on the REST fake's shapes.

import { describe, expect, it } from 'vitest'
import { PULL_REQUEST_LINKS_KEPT } from '../../src/shared/constants'
import {
  createMemoryPullRequestLinkStore,
  parsePullRequestLinkRecords,
  prunePullRequestLinks,
} from '../../src/core/git/pullRequestLinksStore'

const LINK = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 56,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56',
  title: 'README: how this extension is built',
  linkedAt: 1,
}

describe('pull request link store (M123 lane P)', () => {
  it('reads what it wrote, and nothing else', () => {
    expect(parsePullRequestLinkRecords({ session: LINK })).toEqual({ session: LINK })
  })

  it('reads a value that does not validate as none', () => {
    expect(parsePullRequestLinkRecords({ session: { ...LINK, number: '56' } })).toEqual({})
    expect(parsePullRequestLinkRecords([{ session: LINK }])).toEqual({})
    expect(parsePullRequestLinkRecords(undefined)).toEqual({})
  })

  it('keeps the newest links, bounded', () => {
    const links = Object.fromEntries(
      Array.from({ length: PULL_REQUEST_LINKS_KEPT + 2 }, (_, index) => [
        `session-${String(index)}`,
        { ...LINK, number: index, linkedAt: index },
      ]),
    )
    const kept = prunePullRequestLinks(links)
    expect(Object.keys(kept)).toHaveLength(PULL_REQUEST_LINKS_KEPT)
    expect(kept['session-0']).toBeUndefined()
    expect(kept['session-1']).toBeUndefined()
    expect(kept[`session-${String(PULL_REQUEST_LINKS_KEPT + 1)}`]?.linkedAt).toBe(
      PULL_REQUEST_LINKS_KEPT + 1,
    )
  })

  it('keeps the bound per repository root', async () => {
    const store = createMemoryPullRequestLinkStore()
    for (let index = 0; index < PULL_REQUEST_LINKS_KEPT + 1; index += 1) {
      await store.set('/repo', `session-${String(index)}`, {
        ...LINK,
        number: index,
        linkedAt: index,
      })
    }
    await store.set('/other', 'session-0', LINK)
    expect(await store.get('/repo', 'session-0')).toBeUndefined()
    expect(await store.get('/repo', `session-${String(PULL_REQUEST_LINKS_KEPT)}`)).toEqual({
      ...LINK,
      number: PULL_REQUEST_LINKS_KEPT,
      linkedAt: PULL_REQUEST_LINKS_KEPT,
    })
    expect(await store.get('/other', 'session-0')).toEqual(LINK)
    expect(await store.get('/repo', 'missing')).toBeUndefined()
  })

  it('reads a Windows-spelled root as the same root', async () => {
    const store = createMemoryPullRequestLinkStore()
    await store.set(String.raw`C:\work\repo`, 'session', LINK)
    expect(await store.get('C:/work/repo', 'session')).toEqual(LINK)
  })
})
