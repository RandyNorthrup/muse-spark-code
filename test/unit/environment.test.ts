import { describe, expect, it } from 'vitest'
import { describeEnvironment } from '../../src/host/backend/environment'

/** A `git` that answers by argument line; a missing or Error entry rejects. */
function git(answers: Readonly<Record<string, string | Error>>) {
  const calls: string[] = []
  return {
    calls,
    runGit: (args: readonly string[], cwd: string) => {
      const key = args.join(' ')
      calls.push(`${cwd}: ${key}`)
      const answer = answers[key]
      return answer === undefined || answer instanceof Error
        ? Promise.reject(answer ?? new Error(`unexpected git ${key}`))
        : Promise.resolve(answer)
    },
  }
}

describe('describeEnvironment', () => {
  it('reports the branch, the change count and the recent commits from the workspace root', async () => {
    const fake = git({
      'rev-parse --abbrev-ref HEAD': 'main\n',
      'status --porcelain': ' M a.ts\n?? b.ts\n\n',
      'log --oneline -5': 'abc one\ndef two\n',
    })
    await expect(
      describeEnvironment({
        runGit: fake.runGit,
        workspaceRoot: '/ws',
        isWorkspaceTrusted: () => true,
      }),
    ).resolves.toEqual({
      git: { branch: 'main', changedFiles: 2, recentCommits: ['abc one', 'def two'] },
    })
    expect(fake.calls.every((call) => call.startsWith('/ws: '))).toBe(true)
  })

  it('has no git facts without a workspace or outside a repository', async () => {
    const fake = git({ 'rev-parse --abbrev-ref HEAD': new Error('fatal: not a git repository') })
    await expect(
      describeEnvironment({
        runGit: fake.runGit,
        workspaceRoot: undefined,
        isWorkspaceTrusted: () => true,
      }),
    ).resolves.toEqual({ git: undefined })
    expect(fake.calls).toEqual([])
    await expect(
      describeEnvironment({
        runGit: fake.runGit,
        workspaceRoot: '/ws',
        isWorkspaceTrusted: () => true,
      }),
    ).resolves.toEqual({ git: undefined })
  })

  it('runs no git at all in Restricted Mode (D24)', async () => {
    const fake = git({ 'rev-parse --abbrev-ref HEAD': 'main\n' })
    await expect(
      describeEnvironment({
        runGit: fake.runGit,
        workspaceRoot: '/ws',
        isWorkspaceTrusted: () => false,
      }),
    ).resolves.toEqual({ git: undefined })
    expect(fake.calls).toEqual([])
  })

  it('lists no commits for a repository before its first one', async () => {
    const fake = git({
      'rev-parse --abbrev-ref HEAD': 'main\n',
      'status --porcelain': '',
      'log --oneline -5': new Error(
        "fatal: your current branch 'main' does not have any commits yet",
      ),
    })
    await expect(
      describeEnvironment({
        runGit: fake.runGit,
        workspaceRoot: '/ws',
        isWorkspaceTrusted: () => true,
      }),
    ).resolves.toEqual({ git: { branch: 'main', changedFiles: 0, recentCommits: [] } })
  })
})
