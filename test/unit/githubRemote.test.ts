import { describe, expect, it } from 'vitest'
import { githubRepositoryOf, maskRemoteUrl, repositoryLabel } from '../../src/core/git/githubRemote'

describe('githubRepositoryOf (M71)', () => {
  it.each([
    'https://github.com/RandyNorthrup/muse-spark-code.git',
    'https://github.com/RandyNorthrup/muse-spark-code',
    'https://github.com/RandyNorthrup/muse-spark-code/',
    'https://GitHub.com/RandyNorthrup/muse-spark-code.git',
    'https://someone@github.com/RandyNorthrup/muse-spark-code.git',
    'git@github.com:RandyNorthrup/muse-spark-code.git',
    'git@github.com:RandyNorthrup/muse-spark-code',
    'github.com:RandyNorthrup/muse-spark-code.git',
    'ssh://git@github.com/RandyNorthrup/muse-spark-code.git',
    'ssh://git@github.com:22/RandyNorthrup/muse-spark-code',
    'git://github.com/RandyNorthrup/muse-spark-code.git',
    '  https://github.com/RandyNorthrup/muse-spark-code.git\n',
  ])('reads %j as the repository', (url) => {
    expect(githubRepositoryOf(url)).toEqual({ owner: 'RandyNorthrup', name: 'muse-spark-code' })
  })

  it.each([
    'https://gitlab.com/owner/repo.git',
    'https://github.example.com/owner/repo.git',
    'https://github.com.evil.example/owner/repo.git',
    // Plain http, spelled so the lint's https rewrite leaves the case as it is.
    ['http', '://github.com/owner/repo.git'].join(''),
    'file:///C:/repos/owner/repo',
    String.raw`C:\repos\repo`,
    '../repo',
    'git@gitlab.com:owner/repo.git',
    'https://github.com/owner',
    'https://github.com/owner/repo/extra',
    'https://github.com/-owner/repo',
    'https://github.com/owner-/repo',
    'https://github.com/ow--ner/repo',
    'https://github.com/owner/..',
    'https://github.com/owner/re po',
    '',
  ])('does not read %j as a github.com repository', (url) => {
    expect(githubRepositoryOf(url)).toBeUndefined()
  })

  it('labels a repository as GitHub writes it', () => {
    expect(repositoryLabel({ owner: 'a', name: 'b.c' })).toBe('a/b.c')
  })
})

describe('maskRemoteUrl (M71)', () => {
  it('masks an https user-info part, token or name', () => {
    const token = `ghp_${'0'.repeat(36)}`
    expect(maskRemoteUrl(`https://${token}@github.com/o/r.git`)).toBe(
      'https://[redacted]@github.com/o/r.git',
    )
    expect(maskRemoteUrl('https://oauth2:secret@github.com/o/r.git')).toBe(
      'https://[redacted]@github.com/o/r.git',
    )
    expect(maskRemoteUrl('https://me@github.com/o/r.git')).toBe(
      'https://[redacted]@github.com/o/r.git',
    )
  })

  it('keeps what carries no credential', () => {
    for (const url of [
      'https://github.com/o/r.git',
      'git@github.com:o/r.git',
      'ssh://git@github.com/o/r.git',
    ]) {
      expect(maskRemoteUrl(url)).toBe(url)
    }
  })

  it('masks a password in an ssh URL', () => {
    expect(maskRemoteUrl('ssh://git:pw@github.com/o/r.git')).toBe(
      'ssh://[redacted]@github.com/o/r.git',
    )
  })
})
