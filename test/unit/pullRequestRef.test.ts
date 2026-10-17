import { describe, expect, it } from 'vitest'
import {
  isSameRepository,
  pullRequestRefFrom,
  remoteForPullRequest,
} from '../../src/core/git/pullRequestRef'

const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }

describe('pullRequestRefFrom (M71)', () => {
  it.each([
    ['51', 51],
    ['#51', 51],
    [' 56 ', 56],
  ])('reads %j as #%i of the repository the host picks', (input, number) => {
    expect(pullRequestRefFrom(input)).toEqual({ ok: true, number, repository: undefined })
  })

  it.each([
    'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
    'https://github.com/RandyNorthrup/muse-spark-code/pull/51/files',
    'https://github.com/RandyNorthrup/muse-spark-code/pull/51/',
    'https://github.com/RandyNorthrup/muse-spark-code/pull/51#issuecomment-1',
    'https://www.github.com/RandyNorthrup/muse-spark-code/pull/51?w=1',
  ])('reads the page %j with its repository', (input) => {
    expect(pullRequestRefFrom(input)).toEqual({ ok: true, number: 51, repository: REPOSITORY })
  })

  it.each([
    '',
    '0',
    '#',
    '-1',
    '51a',
    // Plain http, spelled so the lint's https rewrite leaves the case as it is.
    ['http', '://github.com/RandyNorthrup/muse-spark-code/pull/51'].join(''),
    'https://github.com/RandyNorthrup/muse-spark-code/issues/51',
    'https://gitlab.com/a/b/pull/1',
    '12345678901',
  ])('refuses %j', (input) => {
    expect(pullRequestRefFrom(input)).toEqual({ ok: false })
  })

  it('compares repositories as GitHub does, ignoring case', () => {
    expect(isSameRepository(REPOSITORY, { owner: 'randynorthrup', name: 'Muse-Spark-Code' })).toBe(
      true,
    )
    expect(isSameRepository(REPOSITORY, { owner: 'RandyNorthrup', name: 'other' })).toBe(false)
  })
})

describe('remoteForPullRequest (M71)', () => {
  const fork = { name: 'origin', repository: { owner: 'me', name: 'muse-spark-code' } }
  const parent = { name: 'upstream', repository: REPOSITORY }
  const other = { name: 'mirror', repository: { owner: 'x', name: 'y' } }

  it('reads a bare number in upstream, the tracked remote, origin, or the only one', () => {
    expect(remoteForPullRequest([fork, parent], undefined, 'origin')).toBe(parent)
    expect(remoteForPullRequest([fork, other], undefined, 'mirror')).toBe(other)
    expect(remoteForPullRequest([other, fork], undefined, undefined)).toBe(fork)
    expect(remoteForPullRequest([other], undefined, undefined)).toBe(other)
    expect(
      remoteForPullRequest([other, { ...other, name: 'b' }], undefined, undefined),
    ).toBeUndefined()
    expect(remoteForPullRequest([], undefined, undefined)).toBeUndefined()
  })

  it('takes only a remote of the repository a page names', () => {
    expect(remoteForPullRequest([fork, parent], REPOSITORY, 'origin')).toBe(parent)
    expect(
      remoteForPullRequest([fork, parent], { owner: 'ME', name: 'muse-spark-code' }, undefined),
    ).toBe(fork)
    expect(remoteForPullRequest([fork], REPOSITORY, undefined)).toBeUndefined()
  })
})
