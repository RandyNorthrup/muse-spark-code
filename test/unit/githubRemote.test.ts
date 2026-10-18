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

  it('R11: masks every query value, whatever the name or its percent-encoded spelling', () => {
    const marker = 'synthetic-probe-marker'
    for (const url of [
      `https://example.invalid/r.git?%74oken=${marker}`,
      `https://example.invalid/r.git?token=${marker}`,
      `https://example.invalid/r.git?access_token=${marker}&x=1`,
      `https://example.invalid/r.git?%61ccess%5Ftoken=${marker}`,
      `https://example.invalid/r.git#${marker}`,
      // A name no redactor knows: its value is masked all the same.
      `https://example.invalid/r.git?x=${marker}`,
      `https://user:${marker}@example.invalid/r.git?sig=${marker}`,
    ]) {
      expect(maskRemoteUrl(url).includes(marker), url).toBe(false)
    }
    // The names stay readable; a local path is shown as it is.
    expect(maskRemoteUrl('https://example.invalid/r.git?%74oken=v')).toBe(
      'https://example.invalid/r.git?token=[redacted]',
    )
    expect(maskRemoteUrl('/srv/git/repo.git')).toBe('/srv/git/repo.git')
    expect(maskRemoteUrl(String.raw`C:\srv\repo.git`)).toBe(String.raw`C:\srv\repo.git`)
  })

  it('keeps a malformed escape in its spelling instead of failing', () => {
    expect(maskRemoteUrl('https://example.invalid/r%XX.git')).toBe(
      'https://example.invalid/r%XX.git',
    )
  })

  it('R11: masks a credential shape that only its percent-decoded spelling shows', () => {
    const token = `ghp_${'0'.repeat(36)}`
    const encoded = `https://github.com/o/${encodeURIComponent(token).replace('g', '%67')}.git`
    expect(maskRemoteUrl(encoded).includes(token)).toBe(false)
    expect(maskRemoteUrl(encoded).includes('0'.repeat(36))).toBe(false)
  })
})
