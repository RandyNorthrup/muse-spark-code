import { describe, expect, it } from 'vitest'
import { describeEnvironment, type EnvironmentDeps } from '../../src/host/backend/environment'
import { FakeLogOutputChannel } from './helpers/fakes'

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

/** The facts from `fake` in /ws, trusted, unless `overrides` says otherwise. */
function gitFacts(
  fake: ReturnType<typeof git>,
  overrides: Partial<EnvironmentDeps> = {},
): { readonly facts: ReturnType<typeof describeEnvironment>; readonly log: FakeLogOutputChannel } {
  const log = new FakeLogOutputChannel()
  const facts = describeEnvironment({
    runGit: fake.runGit,
    workspaceRoot: '/ws',
    isWorkspaceTrusted: () => true,
    log,
    now: () => 0,
    ...overrides,
  })
  return { facts, log }
}

describe('describeEnvironment', () => {
  it('reports the branch, the change count and the recent commits from the workspace root', async () => {
    const fake = git({
      'rev-parse --abbrev-ref HEAD': 'main\n',
      'status --porcelain': ' M a.ts\n?? b.ts\n\n',
      'log --oneline -5': 'abc one\ndef two\n',
    })
    const { facts, log } = gitFacts(fake)
    // All three asked at once (M39), not one after another.
    expect(fake.calls).toHaveLength(3)
    await expect(facts).resolves.toEqual({
      git: { branch: 'main', changedFiles: 2, recentCommits: ['abc one', 'def two'] },
    })
    expect(fake.calls.every((call) => call.startsWith('/ws: '))).toBe(true)
    expect(log.trace).toHaveBeenCalledWith('Git facts for the prompt in 0 ms')
  })

  it('has no git facts without a workspace or outside a repository, and says why', async () => {
    const fake = git({ 'rev-parse --abbrev-ref HEAD': new Error('fatal: not a git repository') })
    await expect(gitFacts(fake, { workspaceRoot: undefined }).facts).resolves.toEqual({
      git: undefined,
    })
    expect(fake.calls).toEqual([])
    const outside = gitFacts(fake)
    await expect(outside.facts).resolves.toEqual({ git: undefined })
    // The log tells a repository from a timeout (M39).
    expect(outside.log.info).toHaveBeenCalledWith(
      'No git facts for the prompt: fatal: not a git repository',
    )
  })

  it('runs no git at all in Restricted Mode (D24)', async () => {
    const fake = git({ 'rev-parse --abbrev-ref HEAD': 'main\n' })
    await expect(gitFacts(fake, { isWorkspaceTrusted: () => false }).facts).resolves.toEqual({
      git: undefined,
    })
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
    await expect(gitFacts(fake).facts).resolves.toEqual({
      git: { branch: 'main', changedFiles: 0, recentCommits: [] },
    })
  })
})
